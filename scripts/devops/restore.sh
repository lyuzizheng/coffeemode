#!/usr/bin/env bash
# ==============================================================================
# CafeMood Disaster Recovery & Database Restoration Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Restores and verifies PostGIS database archives over a connection string:
#   1. Pre-restore SHA256 checksum & pg_restore header integrity check
#   2. Optional Cloudflare R2 automated archive download
#   3. Safety guards & target preparation (drill creates a scratch database)
#   4. pg_restore execution (--clean --if-exists --no-owner) with the client
#      major version the server accepts
#   5. Ownership normalization: every restored application object in `public`
#      goes back to the application role, so a restore performed by the
#      recovery role does not hand the app a read-only schema
#   6. Post-restore verification against the archive's own relation baseline:
#      PostGIS extension, every archived relation present, no relation outside
#      the archive, row counts, spatial queries
#   7. --recreate rollback: restore and verify a replacement database first,
#      then swap it in and retire the old one
#   8. Non-destructive drill mode (--drill): restores into a scratch database on
#      the STAGING database, verifies, then drops it
#
# Verdict (BRAWUKA-728): an unreadable archive, a nonzero pg_restore exit, or a
# failed verification query fails the run in BOTH modes — drill mode never
# reports PASSED for a restore it could not verify, and the scratch database is
# dropped on the failure paths too.
#
# Database topology (BRAWUKA-1010, ADR 0010): staging and production each own a
# Dokploy Postgres service on `dokploy-network`; Supabase keeps Auth only.
# --drill ALWAYS targets staging regardless of --env so prod data is never at
# risk. The client runs inside the database container when the host client's
# major version differs from the server's (lib/pg-client.sh) — the archive
# format is not loadable across that boundary.
#
# Authorized recovery role (ADR-0010 §3): a restore runs as the initdb
# superuser, never as the application role. `pg_restore --clean` drops and
# recreates the PostGIS extension, which the application role cannot do; a
# restore attempted with the app URL exits 1 on `permission denied to create
# extension "postgis"`. Recovery credentials come only from <ENV>_RESTORE_URL
# (operator shell) or --url — never from the app chain, the app env file, or a
# compose env_file, because a restore URL in an env_file is handed to web-prod.
#
# Usage:
#   ./restore.sh [options]
#
# Options:
#   -h, --help                Show this help message and exit
#   -e, --env <staging|prod>  Target environment (required)
#   -f, --file <path>         Path to local backup archive (.dump or .dump.gz)
#   --download-r2 <filename>  Download archive from Cloudflare R2 before restoring
#   --drill                   Non-destructive drill: restore to a scratch database
#                             on the STAGING database, verify, drop it
#   --recreate                Live mode rollback: build a replacement database,
#                             restore and verify it, then swap it in and retire
#                             the old one (requires --yes and the recovery role).
#                             The live database is never dropped before its
#                             replacement passes verification.
#   --yes                     Bypass confirmation prompt (required for automated pipelines)
#   --url <conn>              Explicit connection-string override (opt-in escape hatch;
#                             bypasses per-env scoping — use with care)
#   --dry-run                 Log planned actions without modifying system state
#
# Environment (per-env only — unscoped DATABASE_URL/DIRECT_URL are NEVER read,
# so --env cannot be silently retargeted by the caller's shell, BRAWUKA-241 P0):
#   STAGING_RESTORE_URL / PROD_RESTORE_URL      Authorized recovery role (required
#                                               for live restores; used for drills
#                                               when present). Operator shell only:
#                                               never place it in the compose env
#                                               file, which is passed to web-prod.
#   STAGING_DIRECT_URL / STAGING_DATABASE_URL   Staging database (drill fallback)
#   PROD_DIRECT_URL / PROD_DATABASE_URL         Prod application URL (not restores)
#   RESTORE_OWNER_ROLE                          Role that ends up owning restored
#                                               application objects (default: coffeemode)
#   deploy/dokploy/.env.<env>                   DIRECT_URL is read for drill fallback
#                                               only; it never supplies a recovery URL
#                                               then DATABASE_URL for the app paths
#   PG_CLIENT_CONTAINER                         Optional: database container that runs
#                                               pg_restore/psql (auto-detected from the URL)
#
# Examples:
#   ./restore.sh --env staging --file /backups/coffeemode_staging_snapshot.dump.gz --yes
#   ./restore.sh --env staging --download-r2 coffeemode_staging_pre-migration.dump.gz --drill
#   ./restore.sh --env prod --file /backups/coffeemode_prod_latest.dump.gz --yes
#   ./restore.sh --env prod --file /backups/coffeemode_prod_pre-migration.dump.gz \
#     --recreate --yes
#   ./restore.sh --dry-run --env prod --file dummy.dump.gz
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Shared environment-scoped URL selection (BRAWUKA-747): --url override >
# <ENV>_DIRECT_URL > <ENV>_DATABASE_URL > deploy/dokploy/.env.<env>.
# Unscoped ambient DATABASE_URL/DIRECT_URL are NEVER read (BRAWUKA-241 P0).
# shellcheck source=lib/db-url.sh
source "${SCRIPT_DIR}/lib/db-url.sh"
# shellcheck source=lib/pg-client.sh
source "${SCRIPT_DIR}/lib/pg-client.sh"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
ENV=""
BACKUP_PATH=""
R2_FILENAME=""
DRILL_MODE=false
RECREATE_TARGET=false
CONFIRM_FLAG=false
URL_OVERRIDE=""
DRY_RUN=false

show_help() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    -e|--env)
      ENV="${2:?Error: --env requires an argument (staging|prod)}"
      shift 2
      ;;
    -f|--file)
      BACKUP_PATH="${2:?Error: --file requires a file path}"
      shift 2
      ;;
    --download-r2)
      R2_FILENAME="${2:?Error: --download-r2 requires an R2 object filename}"
      shift 2
      ;;
    --drill)
      DRILL_MODE=true
      shift
      ;;
    --recreate)
      RECREATE_TARGET=true
      shift
      ;;
    --yes)
      CONFIRM_FLAG=true
      shift
      ;;
    --url)
      URL_OVERRIDE="${2:?Error: --url requires a connection string}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    staging|prod)
      ENV="$1"
      shift
      ;;
    *)
      if [[ -z "$BACKUP_PATH" && -f "$1" ]]; then
        BACKUP_PATH="$1"
        shift
      else
        echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "Error: Target environment (--env staging|prod) is required." >&2
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Error: Invalid environment '$ENV'. Must be 'staging' or 'prod'." >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# Logging Utilities
# ------------------------------------------------------------------------------
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${BOLD}${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${BOLD}${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${BOLD}${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${BOLD}${RED}[ERROR]${NC} $*" >&2; }

# ------------------------------------------------------------------------------
# STEP 1: Cloudflare R2 Download (if requested)
# ------------------------------------------------------------------------------
TEMP_DOWNLOAD_DIR="${REPO_ROOT}/backups/temp_restore"

if [[ -n "$R2_FILENAME" ]]; then
  log "Step 1: Downloading backup archive '${R2_FILENAME}' from Cloudflare R2..."
  R2_BUCKET="${R2_BACKUP_BUCKET:-coffeemode-backups}"
  mkdir -p "$TEMP_DOWNLOAD_DIR"
  BACKUP_PATH="${TEMP_DOWNLOAD_DIR}/${R2_FILENAME}"

  if [ "$DRY_RUN" = false ]; then
    if command -v aws >/dev/null 2>&1; then
      AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID required}" \
      AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY required}" \
      aws s3 cp "s3://${R2_BUCKET}/${ENV}/${R2_FILENAME}" "$BACKUP_PATH" \
        --endpoint-url "${R2_ENDPOINT:?R2_ENDPOINT required}"

      # Attempt checksum download
      aws s3 cp "s3://${R2_BUCKET}/${ENV}/${R2_FILENAME}.sha256" "${BACKUP_PATH}.sha256" \
        --endpoint-url "${R2_ENDPOINT}" >/dev/null 2>&1 || true

      ok "Downloaded archive from Cloudflare R2: ${BACKUP_PATH}"
    else
      error "'aws' CLI tool is required for --download-r2."
      exit 1
    fi
  else
    ok "[DRY-RUN] Cloudflare R2 download simulated."
  fi
fi

if [[ -z "$BACKUP_PATH" ]]; then
  echo "Error: Backup file path (--file <path> or --download-r2 <name>) must be provided." >&2
  exit 1
fi

# Per-env connection-string resolution (BRAWUKA-241 P0/P1) lives in the shared
# helper (BRAWUKA-747): --url override > <ENV>_DIRECT_URL > <ENV>_DATABASE_URL >
# deploy/dokploy/.env.<env> (DIRECT_URL line first, then DATABASE_URL).
# Unscoped ambient DATABASE_URL/DIRECT_URL are NEVER consulted: with them in the
# shell, --env staging could otherwise pg_restore --clean into prod.

RESTORE_URL=""
DRILL_DB=""
ADMIN_URL=""
# P2: drop the drill scratch db on ANY exit (failure, signal, success path
# already drops it explicitly — the second DROP is IF EXISTS, so idempotent).
cleanup_drill_db() {
  if [[ "$DRILL_MODE" == "true" && -n "${DRILL_DB:-}" && -n "${ADMIN_URL:-}" && "$DRY_RUN" == "false" ]]; then
    pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -q \
      -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\";" >/dev/null 2>&1 || true
  fi
}
# Temp artifacts and an unswapped replacement database must never outlive the
# run: the replacement is dropped unless step 7 promotes it.
TOC_FILE=""
ARCHIVED_RELATIONS_FILE=""
REPLACEMENT_DB=""
TARGET_DB=""
EXPECTED_DB_OWNER=""
cleanup_restore_artifacts() {
  [[ -n "$TOC_FILE" ]] && rm -f "$TOC_FILE"
  [[ -n "$ARCHIVED_RELATIONS_FILE" ]] && rm -f "$ARCHIVED_RELATIONS_FILE"
  if [[ -n "$REPLACEMENT_DB" && -n "${ADMIN_URL:-}" && "$DRY_RUN" == "false" ]]; then
    pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -q \
      -c "DROP DATABASE IF EXISTS \"${REPLACEMENT_DB}\" WITH (FORCE);" >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_drill_db; cleanup_restore_artifacts' EXIT

# Split a connection string into "<server-without-dbname>" and "?query", so a
# restore can address the maintenance database and a scratch/target database on
# the same server without re-parsing credentials.
db_server_part() {
  local url="$1" base
  base="${url%%\?*}"
  printf '%s' "${base%/*}"
}

db_query_part() {
  local url="$1"
  if [[ "$url" == *"?"* ]]; then printf '?%s' "${url#*\?}"; fi
}

db_dbname_part() {
  local url="$1" base
  base="${url%%\?*}"
  printf '%s' "${base##*/}"
}

if [ "$RECREATE_TARGET" = true ] && [ "$DRILL_MODE" = true ]; then
  error "--recreate applies to live restores only; --drill already restores into a fresh scratch database."
  exit 1
fi

if [ "$DRILL_MODE" = true ]; then
  # Drill always targets the STAGING server under a scratch db name.
  # Staging-only sources: never prod vars, never unscoped ambient vars. The
  # explicit --url escape hatch is intentionally honored here (BRAWUKA-747).
  if [ "$DRY_RUN" = false ]; then
    RECOVERY_URL=""
    if RECOVERY_URL="$(db_url_resolve_restore staging "$URL_OVERRIDE")"; then
      ADMIN_URL="$(db_server_part "$RECOVERY_URL")/postgres$(db_query_part "$RECOVERY_URL")"
    else
      # Fallback keeps the pre-ADR drill behaviour usable, but a role without
      # extension rights fails the drill loudly at pg_restore — it can never
      # report PASSED for a restore it could not perform.
      if ! RECOVERY_URL="$(db_url_resolve staging "$URL_OVERRIDE" pooled)"; then
        error "STAGING_RESTORE_URL (authorized recovery role) or STAGING_DIRECT_URL / STAGING_DATABASE_URL is required for --drill"
        exit 1
      fi
      warn "No STAGING_RESTORE_URL: the drill runs as the application role. It will fail at 'CREATE EXTENSION postgis' unless that role can install extensions (ADR-0010 §3)."
      ADMIN_URL="$(db_server_part "$RECOVERY_URL")/postgres$(db_query_part "$RECOVERY_URL")"
    fi
    DRILL_DB="restore_drill_$(date -u +%Y%m%d_%H%M%S)_$$"
    RESTORE_URL="$(db_server_part "$RECOVERY_URL")/${DRILL_DB}$(db_query_part "$RECOVERY_URL")"
  else
    RESTORE_URL="<staging-url>/<drill-db>"
  fi
else
  if [ "$DRY_RUN" = false ]; then
    if ! RESTORE_URL="$(db_url_resolve_restore "$ENV" "$URL_OVERRIDE")"; then
      ENV_UPPER="$(printf '%s' "$ENV" | tr '[:lower:]' '[:upper:]')"
      error "Authorized recovery role for ${ENV} is required: ${ENV_UPPER}_RESTORE_URL or the RESTORE_URL line in deploy/dokploy/.env.${ENV} (ADR-0010 §3). The application role cannot restore: pg_restore must recreate the PostGIS extension."
      exit 1
    fi
    ADMIN_URL="$(db_server_part "$RESTORE_URL")/postgres$(db_query_part "$RESTORE_URL")"
  else
    RESTORE_URL="<database-url>"
  fi
fi

RESTORE_OWNER_ROLE="${RESTORE_OWNER_ROLE:-coffeemode}"
if [[ ! "$RESTORE_OWNER_ROLE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  error "RESTORE_OWNER_ROLE must be a plain role name (got '${RESTORE_OWNER_ROLE}')."
  exit 1
fi

if [ "$RECREATE_TARGET" = true ] && [ "$DRY_RUN" = false ]; then
  if [ "$CONFIRM_FLAG" != true ]; then
    error "--recreate drops the ${ENV} database; it requires --yes."
    exit 1
  fi
  TARGET_DB="$(db_dbname_part "$RESTORE_URL")"
  case "$TARGET_DB" in
    ""|postgres|template0|template1|*/*)
      error "--recreate refuses target database '${TARGET_DB}'."
      exit 1
      ;;
  esac
fi

echo "=============================================================================="
echo -e "${BOLD}CafeMood Disaster Recovery Suite${NC}"
echo "Environment:     ${ENV}"
echo "Mode:            $([ "$DRILL_MODE" = true ] && echo "NON-DESTRUCTIVE RECOVERY DRILL (staging scratch db)" || echo "LIVE RESTORATION")"
echo "Target:          $([ "$DRILL_MODE" = true ] && echo "staging scratch database ${DRILL_DB}" || echo "Dokploy ${ENV} Postgres (per-env URL)")"
echo "Backup Archive:  ${BACKUP_PATH}"
echo "=============================================================================="

# Single client-mode decision for every tool this run invokes (BRAWUKA-1015):
# host when the host client matches the server major, else the database
# container; a version mismatch with no container fails closed here. Drill mode
# plans against the server's maintenance database — the scratch target does not
# exist yet, so probing it would fail the connection before the mode is chosen.
if [ "$DRY_RUN" = false ]; then
  pg_client_plan "${ADMIN_URL:-$RESTORE_URL}" pg_restore psql || exit 1
fi

# ------------------------------------------------------------------------------
# STEP 2: Archive Integrity & Checksum Verification
# ------------------------------------------------------------------------------
log "Step 2: Verifying backup archive integrity and checksum..."

if [ "$DRY_RUN" = false ]; then
  if [[ ! -f "$BACKUP_PATH" ]]; then
    error "Backup file not found: ${BACKUP_PATH}"
    exit 1
  fi

  # Verify SHA256 checksum if available
  CHECKSUM_FILE="${BACKUP_PATH}.sha256"
  if [[ -f "$CHECKSUM_FILE" ]]; then
    log "Verifying SHA256 cryptographic checksum..."
    EXPECTED_HASH="$(awk '{print $1}' "$CHECKSUM_FILE")"
    ACTUAL_HASH="$(sha256sum "$BACKUP_PATH" | awk '{print $1}')"
    if [[ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]]; then
      error "Checksum verification FAILED!"
      error "Expected: ${EXPECTED_HASH}"
      error "Actual:   ${ACTUAL_HASH}"
      exit 1
    fi
    ok "SHA256 checksum verified: ${ACTUAL_HASH}"
  else
    warn "No .sha256 checksum file found. Skipping cryptographic verification."
  fi

  # Archive readability (BRAWUKA-728): a truncated/malformed archive must be
  # rejected here, before step 4 creates a scratch database. The probe mirrors
  # step 5's decompression path so it proves what pg_restore will actually read.
  #
  # BRAWUKA-753: pg_restore stops reading once it has the table of contents, so a
  # bare `gzip -dc | pg_restore --list` kills gzip with SIGPIPE (141) on any
  # archive larger than the pipe buffer and `pipefail` then rejects a *valid*
  # backup. The trailing `cat` drains the rest of the stream, which keeps the
  # decompressor alive to completion: with `pipefail` both statuses stay verdicts
  # (corrupt/truncated gzip stream, or bytes that are not a pg_restore archive).
  log "Verifying pg_restore archive readability..."
  TOC_FILE="$(mktemp "${TMPDIR:-/tmp}/coffeemode_restore_toc.XXXXXX")"
  ARCHIVED_RELATIONS_FILE="$(mktemp "${TMPDIR:-/tmp}/coffeemode_restore_rels.XXXXXX")"
  ARCHIVE_READABLE=true
  if [[ "$BACKUP_PATH" == *.gz ]]; then
    gzip -dc "$BACKUP_PATH" | { pg_run pg_restore --list > "$TOC_FILE" && cat >/dev/null; } \
      || ARCHIVE_READABLE=false
  else
    # stdin, never a path: a container-mode client cannot see the host file.
    pg_run pg_restore --list < "$BACKUP_PATH" > "$TOC_FILE" || ARCHIVE_READABLE=false
  fi
  if [[ "$ARCHIVE_READABLE" != true ]]; then
    error "Archive is not a readable pg_restore archive: ${BACKUP_PATH}"
    exit 1
  fi
  # Relation baseline of the archive itself (BRAWUKA-1015 P1): verification
  # compares the restored database against these entries, so an empty
  # pre-migration snapshot is validated as that baseline instead of being
  # rejected for a missing `cafes` table.
  sed -nE 's/^[0-9]+; [0-9]+ [0-9]+ (TABLE|VIEW|MATERIALIZED VIEW|SEQUENCE|FOREIGN TABLE) public ([A-Za-z0-9_]+) .*/\2/p' \
    "$TOC_FILE" | sort -u > "$ARCHIVED_RELATIONS_FILE"
  ARCHIVED_RELATION_COUNT="$(wc -l < "$ARCHIVED_RELATIONS_FILE" | tr -d '[:space:]')"
  ok "Archive verified: ${ARCHIVED_RELATION_COUNT} application relation(s) in its table of contents."
else
  ok "[DRY-RUN] Archive integrity verification simulated."
fi

# ------------------------------------------------------------------------------
# STEP 3: Safety Guard & Confirmation Prompt
# ------------------------------------------------------------------------------
if [ "$DRILL_MODE" = false ] && [ "$DRY_RUN" = false ]; then
  if [ "$CONFIRM_FLAG" = false ]; then
    echo ""
    echo -e "${BOLD}${RED}CRITICAL WARNING: This will overwrite the Dokploy ${ENV} database!${NC}"
    read -rp "Are you sure you want to proceed with live database restore? (Type 'RESTORE' to confirm): " CONFIRMATION
    if [[ "$CONFIRMATION" != "RESTORE" ]]; then
      echo "Restoration aborted by operator."
      exit 0
    fi
  fi
fi

# ------------------------------------------------------------------------------
# STEP 3b: Recovery-role preflight (before any destructive SQL)
# ------------------------------------------------------------------------------
# BRAWUKA-1015 P0: a recovery URL that points at the application role must fail
# here, not after the target has been dropped. Only a superuser can recreate the
# PostGIS extension, and only a superuser may run --recreate.
TARGET_ORIGINAL_OWNER=""
if [ "$DRILL_MODE" = false ] && [ "$DRY_RUN" = false ]; then
  log "Step 3b: Verifying the recovery role before touching the target..."
  RECOVERY_IS_SUPER="$(pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -t -A -c "select rolsuper from pg_roles where rolname = current_user;")" || {
    error "Recovery-role preflight FAILED: cannot query pg_roles as the configured role."
    exit 1
  }
  RECOVERY_IS_SUPER="${RECOVERY_IS_SUPER//[[:space:]]/}"
  if [[ "$RECOVERY_IS_SUPER" != "t" ]]; then
    error "Recovery-role preflight FAILED: the configured role is not a superuser, so it cannot recreate the PostGIS extension. Refusing destructive SQL (ADR-0010 §3). Use PROD_RESTORE_URL/STAGING_RESTORE_URL with the initdb superuser."
    exit 1
  fi
  if [[ -n "$TARGET_DB" ]]; then
    TARGET_DB_EXISTS="$(pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -t -A -c "select count(*) from pg_database where datname = '${TARGET_DB}';")"
    TARGET_DB_EXISTS="${TARGET_DB_EXISTS//[[:space:]]/}"
    if [[ "$RECREATE_TARGET" = true && "$TARGET_DB_EXISTS" != "1" ]]; then
      error "Recovery-role preflight FAILED: target database '${TARGET_DB}' does not exist; --recreate preserves and retires an existing database, it does not create one from nothing."
      exit 1
    fi
    if [[ "$TARGET_DB_EXISTS" == "1" ]]; then
      TARGET_ORIGINAL_OWNER="$(pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -t -A -c "select pg_get_userbyid(datdba) from pg_database where datname = '${TARGET_DB}';")"
      TARGET_ORIGINAL_OWNER="${TARGET_ORIGINAL_OWNER//[[:space:]]/}"
    fi
  fi
  ok "Recovery role is a superuser; target '${TARGET_DB:-?}' owner '${TARGET_ORIGINAL_OWNER:-n/a}'."
fi

# ------------------------------------------------------------------------------
# STEP 4: Target Preparation (drill scratch db; no container health check)
# ------------------------------------------------------------------------------
log "Step 4: Preparing restore target..."

if [ "$DRY_RUN" = false ]; then
  if [ "$DRILL_MODE" = true ]; then
    log "Creating scratch drill database '${DRILL_DB}' on the staging database..."
    pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
      -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\";" \
      -c "CREATE DATABASE \"${DRILL_DB}\" OWNER \"${RESTORE_OWNER_ROLE}\";" >/dev/null
    EXPECTED_DB_OWNER="$RESTORE_OWNER_ROLE"
    ok "Scratch drill database created: ${DRILL_DB}"
  elif [ "$RECREATE_TARGET" = true ]; then
    # Rollback path (ADR-0010 §6.7). 'pg_restore --clean' over a populated
    # database cannot revert the schema — dropping the PostGIS extension fails
    # while dependent objects exist, and the migration ledger survives. The
    # rollback therefore builds a replacement database and only swaps it in
    # after the restore passes verification; the live database is never dropped
    # before that (BRAWUKA-1015 P0).
    REPLACEMENT_DB="${TARGET_DB}__restore_$(date -u +%Y%m%d_%H%M%S)_$$"
    replacement_owner="${TARGET_ORIGINAL_OWNER:-$RESTORE_OWNER_ROLE}"
    EXPECTED_DB_OWNER="$replacement_owner"
    log "Creating replacement database '${REPLACEMENT_DB}' (owner: ${replacement_owner}); '${TARGET_DB}' stays live until verification passes..."
    pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
      -c "CREATE DATABASE \"${REPLACEMENT_DB}\" OWNER \"${replacement_owner}\";" >/dev/null
    RESTORE_URL="$(db_server_part "$RESTORE_URL")/${REPLACEMENT_DB}$(db_query_part "$RESTORE_URL")"
    ok "Replacement database created; this run restores into '${REPLACEMENT_DB}'."
  else
    log "Live restore target: Dokploy ${ENV} Postgres (own session only; no other backend is terminated)."
  fi
else
  ok "[DRY-RUN] Database preparation simulated."
fi

# ------------------------------------------------------------------------------
# STEP 5: Database Restoration via pg_restore
# ------------------------------------------------------------------------------
RESTORE_LABEL="$([ "$DRILL_MODE" = true ] && echo "scratch database '${DRILL_DB}' (staging)" || echo "Dokploy ${ENV} Postgres")"
log "Step 5: Restoring database schema and data into ${RESTORE_LABEL}..."

if [ "$DRY_RUN" = false ]; then
  set -o pipefail

  # --no-owner is deliberate: objects are created by the recovery role, then
  # step 5b hands the application objects back to the app role. Restoring with
  # --role=coffeemode instead would run 'CREATE EXTENSION postgis' as the app
  # role and fail on privileges.
  run_pg_restore() {
    if [[ "$BACKUP_PATH" == *.gz ]]; then
      log "Decompressing gzip archive stream to pg_restore..."
      gzip -dc "$BACKUP_PATH" | pg_run pg_restore -d "$RESTORE_URL" --clean --if-exists --no-owner --verbose
    else
      pg_run pg_restore -d "$RESTORE_URL" --clean --if-exists --no-owner --verbose < "$BACKUP_PATH"
    fi
  }

  # pg_restore's exit status is the restore verdict in BOTH modes (BRAWUKA-728).
  # Drill mode is the gate that certifies a backup is restorable, so a nonzero
  # exit may never be downgraded to a warning: the only diagnostics tolerated
  # are the ones pg_restore reports with exit status 0 (e.g. `--clean
  # --if-exists` skipping objects the target does not have). Everything else —
  # including an unreadable archive stream — fails the drill. The scratch
  # database is still dropped on this path by the EXIT trap.
  if ! run_pg_restore; then
    if [ "$DRILL_MODE" = true ]; then
      error "pg_restore FAILED during recovery drill: refusing to certify '${BACKUP_PATH}' as restorable."
    else
      error "CRITICAL: Live database restore FAILED on the Dokploy ${ENV} database!"
    fi
    exit 1
  fi
  ok "Database restore command executed (pg_restore exit status 0)."
else
  ok "[DRY-RUN] Restoration via pg_restore simulated."
fi

# ------------------------------------------------------------------------------
# STEP 5b: Ownership normalization (application objects back to the app role)
# ------------------------------------------------------------------------------
if [ "$DRY_RUN" = false ]; then
  log "Step 5b: Normalizing ownership of restored application objects to '${RESTORE_OWNER_ROLE}'..."
  # --no-owner means pg_restore creates every object as the connected (recovery)
  # role. Without this step the application would own nothing it just restored,
  # so migrations and writes would fail. Extension members (e.g. spatial_ref_sys)
  # are deliberately left with the recovery role: only a superuser owns PostGIS.
  if ! pg_run psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
DECLARE
  owner_name text := '${RESTORE_OWNER_ROLE}';
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_name) THEN
    RAISE EXCEPTION 'application role % does not exist on the target server', owner_name;
  END IF;
  FOR r IN
    SELECT c.oid::regclass AS ident, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m','S','f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
      AND pg_get_userbyid(c.relowner) <> owner_name
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE r.relkind
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'f' THEN 'FOREIGN TABLE'
        ELSE 'TABLE'
      END, r.ident, owner_name);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS ident
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
      AND pg_get_userbyid(p.proowner) <> owner_name
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.ident, owner_name);
  END LOOP;
  FOR r IN
    -- 'e' enum / 'd' domain / 'r' range only: composite row types of tables
    -- and views are owned through their relation and reject ALTER TYPE.
    SELECT t.oid::regtype AS ident
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e','d','r')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
      AND pg_get_userbyid(t.typowner) <> owner_name
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO %I', r.ident, owner_name);
  END LOOP;
  -- The schema itself must belong to the app role too: a restored schema owned
  -- by the recovery role would block future migrations (BRAWUKA-1015 review).
  IF to_regnamespace('public') IS NOT NULL THEN
    EXECUTE format('ALTER SCHEMA public OWNER TO %I', owner_name);
  END IF;
END
\$\$;
SQL
  then
    error "Ownership normalization FAILED on ${RESTORE_LABEL}."
    exit 1
  fi
  ok "Application objects in 'public' are owned by '${RESTORE_OWNER_ROLE}'."
else
  ok "[DRY-RUN] Ownership normalization simulated."
fi

# ------------------------------------------------------------------------------
# STEP 6: Post-Restore Verification (PostGIS, Table Counts, Spatial Queries)
# ------------------------------------------------------------------------------
log "Step 6: Executing post-restore data and spatial contract verification..."

if [ "$DRY_RUN" = false ]; then
  # Single scalar query helper (BRAWUKA-728). ON_ERROR_STOP turns a missing
  # relation, a missing function, or a lost connection into a nonzero psql exit;
  # no check below may substitute a default value for a failed query.
  # </dev/null is deliberate: these queries run inside loops whose stdin is the
  # archive baseline list, and a container-mode `docker exec -i` would otherwise
  # consume that stream and silently truncate verification.
  psql_scalar() {
    pg_run psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -t -A -c "$1" < /dev/null
  }

  # 1. PostGIS extension verification
  if ! POSTGIS_VERSION="$(psql_scalar 'SELECT PostGIS_Version();')"; then
    error "PostGIS extension check FAILED on ${RESTORE_LABEL}: SELECT PostGIS_Version() did not succeed."
    exit 1
  fi
  POSTGIS_VERSION="${POSTGIS_VERSION//[[:space:]]/}"
  if [[ -z "$POSTGIS_VERSION" ]]; then
    error "PostGIS extension check FAILED on ${RESTORE_LABEL}: PostGIS is not installed."
    exit 1
  fi
  ok "PostGIS extension verified: ${POSTGIS_VERSION}"

  # 2. Relation baseline (BRAWUKA-1015): the restored database must carry
  #    exactly the archive's application relations. Every archived relation must
  #    exist, and every non-extension relation in 'public' must be in the
  #    archive. That is the rollback guarantee: a restore reproduces the
  #    snapshot instead of layering onto whatever the live database held.
  while IFS= read -r relation; do
    [[ -n "$relation" ]] || continue
    if ! EXISTS="$(psql_scalar "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '${relation}';")"; then
      error "Verification FAILED on ${RESTORE_LABEL}: query for archived relation '${relation}' did not succeed."
      exit 1
    fi
    EXISTS="${EXISTS//[[:space:]]/}"
    if [[ "$EXISTS" != "1" ]]; then
      error "Verification FAILED on ${RESTORE_LABEL}: archived relation '${relation}' is missing from the restored database."
      exit 1
    fi
  done < "$ARCHIVED_RELATIONS_FILE"
  ok "All ${ARCHIVED_RELATION_COUNT} archived relation(s) exist in the restored database."

  ARCHIVED_TABLES="$(sed -nE 's/^[0-9]+; [0-9]+ [0-9]+ TABLE public ([A-Za-z0-9_]+) .*/\1/p' "$TOC_FILE" | sort -u)"
  ARCHIVED_IN_LIST="$(sed "s/^/'/;s/$/'/" "$ARCHIVED_RELATIONS_FILE" | paste -sd, -)"
  if [[ -n "$ARCHIVED_IN_LIST" ]]; then
    EXTRAS_SQL="SELECT coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') AND c.relname NOT IN (${ARCHIVED_IN_LIST});"
  else
    EXTRAS_SQL="SELECT coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');"
  fi
  if ! EXTRAS="$(psql_scalar "$EXTRAS_SQL")"; then
    error "Verification FAILED on ${RESTORE_LABEL}: could not compare restored relations with the archive baseline."
    exit 1
  fi
  if [[ -n "${EXTRAS//[[:space:]]/}" ]]; then
    error "Verification FAILED on ${RESTORE_LABEL}: relation(s) present but absent from the archive: ${EXTRAS}."
    exit 1
  fi
  ok "No relations outside the archive baseline: the restore reproduced the snapshot."

  # 3. Restored content: row counts for every archived table (proves the data
  #    section loaded, not just the schema), plus the seeded contract.
  RESTORED_ROWS=0
  while IFS= read -r table; do
    [[ -n "$table" ]] || continue
    if ! COUNT="$(psql_scalar "SELECT count(*) FROM \"${table}\";")"; then
      error "Verification FAILED on ${RESTORE_LABEL}: archived table '${table}' is unreadable."
      exit 1
    fi
    COUNT="${COUNT//[[:space:]]/}"
    if [[ ! "$COUNT" =~ ^[0-9]+$ ]]; then
      error "Verification FAILED on ${RESTORE_LABEL}: row count for '${table}' was '${COUNT}', not a number."
      exit 1
    fi
    log "Row count: ${table}=${COUNT}"
    case "$table" in
      cafes|checkins|profiles) RESTORED_ROWS=$((RESTORED_ROWS + COUNT)) ;;
    esac
  done < <(printf '%s\n' "$ARCHIVED_TABLES")

  if grep -Fxq cafes "$ARCHIVED_RELATIONS_FILE"; then
    if [[ "$RESTORED_ROWS" -eq 0 ]]; then
      error "Verification FAILED on ${RESTORE_LABEL}: seeded archive restored cafes/checkins/profiles all empty."
      exit 1
    fi
    ok "Seeded content verified: ${RESTORED_ROWS} row(s) across cafes/checkins/profiles."

    # 4. Spatial query contract benchmark (cafes.location geography column per 0001_init.sql)
    if ! SPATIAL_CHECK="$(psql_scalar \
      "SELECT count(*) FROM cafes WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(103.8198, 1.3521), 4326)::geography, 10000);")"; then
      error "PostGIS spatial query check FAILED on ${RESTORE_LABEL}."
      exit 1
    fi
    SPATIAL_CHECK="${SPATIAL_CHECK//[[:space:]]/}"
    if [[ ! "$SPATIAL_CHECK" =~ ^[0-9]+$ ]]; then
      error "PostGIS spatial query check FAILED on ${RESTORE_LABEL}: no numeric result ('${SPATIAL_CHECK}')."
      exit 1
    fi
    ok "PostGIS spatial query test returned ${SPATIAL_CHECK} cafe(s) in range."
  else
    ok "Baseline archive (no application tables): verified as an empty-schema snapshot."
  fi

  # 4. Ownership contract (ADR-0010 §3): pg_restore ran as the recovery role,
  #    so every application object must have been handed back to the app role.
  #    A leftover object would leave the application unable to migrate or write.
  if ! STRAY_OWNERS="$(psql_scalar "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') AND pg_get_userbyid(c.relowner) <> '${RESTORE_OWNER_ROLE}';")"; then
    error "Ownership verification FAILED on ${RESTORE_LABEL}: could not count objects not owned by '${RESTORE_OWNER_ROLE}'."
    exit 1
  fi
  STRAY_OWNERS="${STRAY_OWNERS//[[:space:]]/}"
  if [[ "$STRAY_OWNERS" != "0" ]]; then
    error "Ownership verification FAILED on ${RESTORE_LABEL}: ${STRAY_OWNERS} application object(s) are not owned by '${RESTORE_OWNER_ROLE}'."
    exit 1
  fi
  if ! OWNER_FLAGS="$(psql_scalar "SELECT rolname || ' superuser=' || rolsuper || ' createdb=' || rolcreatedb FROM pg_roles WHERE rolname = '${RESTORE_OWNER_ROLE}';")"; then
    error "Ownership verification FAILED on ${RESTORE_LABEL}: application role '${RESTORE_OWNER_ROLE}' is missing."
    exit 1
  fi
  ok "Ownership contract verified: 0 stray application objects; ${OWNER_FLAGS}."

  # 6. Layer-owner agreement (BRAWUKA-1015 P1): objects were normalised above,
  #    but the database and the schema are separate objects with their own
  #    owners. A rollback must reproduce the snapshot's ownership, not just its
  #    tables, or the application later cannot migrate or write.
  if [[ -n "$EXPECTED_DB_OWNER" ]]; then
    if ! restored_db_owner="$(psql_scalar 'SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database();')"; then
      error "Ownership verification FAILED on ${RESTORE_LABEL}: could not read the database owner."
      exit 1
    fi
    restored_db_owner="${restored_db_owner//[[:space:]]/}"
    if [[ "$restored_db_owner" != "$EXPECTED_DB_OWNER" ]]; then
      error "Ownership verification FAILED on ${RESTORE_LABEL}: database owner is '${restored_db_owner}', expected '${EXPECTED_DB_OWNER}'."
      exit 1
    fi
    ok "Database owner verified: ${restored_db_owner}."
  fi
  if ! restored_schema_owner="$(psql_scalar "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public';")"; then
    error "Ownership verification FAILED on ${RESTORE_LABEL}: could not read the 'public' schema owner."
    exit 1
  fi
  restored_schema_owner="${restored_schema_owner//[[:space:]]/}"
  if [[ "$restored_schema_owner" != "$RESTORE_OWNER_ROLE" ]]; then
    error "Ownership verification FAILED on ${RESTORE_LABEL}: schema 'public' is owned by '${restored_schema_owner}', expected '${RESTORE_OWNER_ROLE}'."
    exit 1
  fi
  ok "Schema owner verified: public -> ${restored_schema_owner}."

  # 7. Cleanup drill scratch database on the staging project
  if [ "$DRILL_MODE" = true ]; then
    log "Cleaning up scratch drill database '${DRILL_DB}'..."
    pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
      -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\";" >/dev/null
    ok "Scratch drill database removed."
  fi
else
  ok "[DRY-RUN] Post-restore validation queries simulated."
fi

# ------------------------------------------------------------------------------
# STEP 7: Swap the verified replacement into place (--recreate only)
# ------------------------------------------------------------------------------
# The live database was untouched through steps 4-6. Only now, with the
# replacement verified against the archive baseline, does the target name move:
# the old database is renamed to a retired name, the replacement takes the live
# name, and the retired copy is dropped. A crash between the two renames leaves
# the old data intact under the retired name; recovery is a rename back.
if [ "$RECREATE_TARGET" = true ] && [ "$DRY_RUN" = false ]; then
  log "Step 7: Swapping verified replacement '${REPLACEMENT_DB}' into '${TARGET_DB}'..."
  pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${TARGET_DB}', '${REPLACEMENT_DB}') AND pid <> pg_backend_pid();" >/dev/null
  RETIRED_DB="${TARGET_DB}__retired_$(date -u +%Y%m%d_%H%M%S)_$$"
  pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "ALTER DATABASE \"${TARGET_DB}\" RENAME TO \"${RETIRED_DB}\";" >/dev/null
  pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "ALTER DATABASE \"${REPLACEMENT_DB}\" RENAME TO \"${TARGET_DB}\";" >/dev/null
  REPLACEMENT_DB=""
  pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE \"${RETIRED_DB}\" WITH (FORCE);" >/dev/null
  if [[ -n "$EXPECTED_DB_OWNER" ]]; then
    promoted_owner="$(pg_run psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -t -A -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${TARGET_DB}';" < /dev/null)"
    promoted_owner="${promoted_owner//[[:space:]]/}"
    if [[ "$promoted_owner" != "$EXPECTED_DB_OWNER" ]]; then
      error "Swap owner check FAILED: '${TARGET_DB}' is owned by '${promoted_owner}', expected '${EXPECTED_DB_OWNER}'."
      exit 1
    fi
  fi
  ok "Swap complete: '${TARGET_DB}' now serves the verified archive; old data dropped."
fi

# Cleanup temp downloads
rm -rf "$TEMP_DOWNLOAD_DIR" 2>/dev/null || true

echo ""
echo "=============================================================================="
if [ "$DRILL_MODE" = true ]; then
  echo -e "${BOLD}${GREEN}Disaster Recovery Drill Completed Successfully!${NC}"
  echo "Result:          PASSED — All PostGIS spatial contracts verified."
else
  echo -e "${BOLD}${GREEN}Database Restoration Completed Successfully!${NC}"
  echo "Target:          Dokploy ${ENV} Postgres"
  echo "Mode:            $([ "$RECREATE_TARGET" = true ] && echo "rollback (replacement verified, then swapped in)" || echo "in-place restore")"
  echo "Status:          Active & Verified"
fi
echo "=============================================================================="
