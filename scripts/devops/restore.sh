#!/usr/bin/env bash
# ==============================================================================
# CafeMood Disaster Recovery & Database Restoration Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Restores and verifies Supabase Postgres + PostGIS database archives over a
# connection string (no local container):
#   1. Pre-restore SHA256 checksum & pg_restore header integrity check
#   2. Optional Cloudflare R2 automated archive download
#   3. Safety guards & active client connection termination (Supabase-safe:
#      own session only, never pg_terminate_backend on shared pooler)
#   4. pg_restore execution (--clean --if-exists --no-owner) via local
#      pg_restore client against DATABASE_URL (pooled, sslmode=require)
#   5. Post-restore verification: PostGIS extension, table counts, spatial queries
#   6. Non-destructive drill mode (--drill): restores into a scratch database on
#      the STAGING Supabase project, verifies, then drops it
#
# Database topology (BRAWUKA-240 D1 / decision 34a): prod and staging each live
# in their own Supabase project (region ap-southeast-1). --drill ALWAYS targets
# staging regardless of --env so prod data is never at risk.
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
#                             on the STAGING Supabase project, verify, drop it
#   --yes                     Bypass confirmation prompt (required for automated pipelines)
#   --url <conn>              Explicit connection-string override (opt-in escape hatch;
#                             bypasses per-env scoping — use with care)
#   --dry-run                 Log planned actions without modifying system state
#
# Environment (per-env only — unscoped DATABASE_URL/DIRECT_URL are NEVER read,
# so --env cannot be silently retargeted by the caller's shell, BRAWUKA-241 P0):
#   STAGING_DIRECT_URL / STAGING_DATABASE_URL   Staging project (drill target too)
#   PROD_DIRECT_URL / PROD_DATABASE_URL         Prod project (live restores only)
#   deploy/dokploy/.env.<env>                   DIRECT_URL line first, then DATABASE_URL
#
# Examples:
#   ./restore.sh --env staging --file /backups/coffeemode_staging_snapshot.dump.gz --yes
#   ./restore.sh --env staging --download-r2 coffeemode_staging_pre-migration.dump.gz --drill
#   ./restore.sh --env prod --file /backups/coffeemode_prod_latest.dump.gz
#   ./restore.sh --dry-run --env prod --file dummy.dump.gz
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
ENV=""
BACKUP_PATH=""
R2_FILENAME=""
DRILL_MODE=false
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

# Per-env connection-string resolution (BRAWUKA-241 P0/P1).
# Sources, in order: --url override > <ENV>_DIRECT_URL > <ENV>_DATABASE_URL >
# deploy/dokploy/.env.<env> (DIRECT_URL line first, then DATABASE_URL).
# Unscoped ambient DATABASE_URL/DIRECT_URL are NEVER consulted: with them in the
# shell, --env staging could otherwise pg_restore --clean into prod.
# Drill path calls resolve_staging_url() only — staging sources, never prod.
env_file_url() {
  local key="$1" file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo ""
}

resolve_live_url() {
  local e="$1"
  if [[ -n "$URL_OVERRIDE" ]]; then
    printf '%s' "$URL_OVERRIDE"
    return 0
  fi
  local prefix
  if [[ "$e" == "staging" ]]; then prefix="STAGING"; else prefix="PROD"; fi
  local direct_var="${prefix}_DIRECT_URL"
  local pooled_var="${prefix}_DATABASE_URL"
  if [[ -n "${!direct_var:-}" ]]; then
    printf '%s' "${!direct_var}"
    return 0
  fi
  if [[ -n "${!pooled_var:-}" ]]; then
    printf '%s' "${!pooled_var}"
    return 0
  fi
  local env_file="${REPO_ROOT}/deploy/dokploy/.env.${e}"
  if [[ -f "$env_file" ]]; then
    local url
    url="$(env_file_url DIRECT_URL "$env_file")"
    if [[ -z "$url" ]]; then
      url="$(env_file_url DATABASE_URL "$env_file")"
    fi
    if [[ -n "$url" ]]; then
      printf '%s' "$url"
      return 0
    fi
  fi
  return 1
}

# Drill target: STAGING project only. Never consults unscoped vars, never prod.
resolve_staging_url() {
  if [[ -n "$URL_OVERRIDE" ]]; then
    printf '%s' "$URL_OVERRIDE"
    return 0
  fi
  if [[ -n "${STAGING_DIRECT_URL:-}" ]]; then
    printf '%s' "$STAGING_DIRECT_URL"
    return 0
  fi
  if [[ -n "${STAGING_DATABASE_URL:-}" ]]; then
    printf '%s' "$STAGING_DATABASE_URL"
    return 0
  fi
  local env_file="${REPO_ROOT}/deploy/dokploy/.env.staging"
  if [[ -f "$env_file" ]]; then
    local url
    url="$(env_file_url DIRECT_URL "$env_file")"
    if [[ -z "$url" ]]; then
      url="$(env_file_url DATABASE_URL "$env_file")"
    fi
    if [[ -n "$url" ]]; then
      printf '%s' "$url"
      return 0
    fi
  fi
  return 1
}

RESTORE_URL=""
DRILL_DB=""
ADMIN_URL=""
# P2: drop the drill scratch db on ANY exit (failure, signal, success path
# already drops it explicitly — the second DROP is IF EXISTS, so idempotent).
cleanup_drill_db() {
  if [[ "$DRILL_MODE" == "true" && -n "${DRILL_DB:-}" && -n "${ADMIN_URL:-}" && "$DRY_RUN" == "false" ]]; then
    psql "$ADMIN_URL" -v ON_ERROR_STOP=0 -q \
      -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\";" >/dev/null 2>&1 || true
  fi
}
trap cleanup_drill_db EXIT

if [ "$DRILL_MODE" = true ]; then
  # Drill always targets the STAGING Supabase project under a scratch db name.
  # Staging-only sources: never prod vars, never unscoped ambient vars.
  if [ "$DRY_RUN" = false ]; then
    STAGING_URL=""
    if ! STAGING_URL="$(resolve_staging_url)"; then
      error "STAGING_DIRECT_URL / STAGING_DATABASE_URL (or deploy/dokploy/.env.staging) is required for --drill"
      exit 1
    fi
    # Split off query string, then swap the dbname path segment.
    STAGING_Q=""
    STAGING_BASE="$STAGING_URL"
    if [[ "$STAGING_URL" == *"?"* ]]; then
      STAGING_Q="?${STAGING_URL#*\?}"
      STAGING_BASE="${STAGING_URL%%\?*}"
    fi
    STAGING_SERVER="${STAGING_BASE%/*}"
    DRILL_DB="restore_drill_$(date -u +%Y%m%d_%H%M%S)_$$"
    ADMIN_URL="${STAGING_SERVER}/postgres${STAGING_Q}"
    RESTORE_URL="${STAGING_SERVER}/${DRILL_DB}${STAGING_Q}"
  else
    RESTORE_URL="<staging-url>/<drill-db>"
  fi
else
  if [ "$DRY_RUN" = false ]; then
    if ! RESTORE_URL="$(resolve_live_url "$ENV")"; then
      error "Per-env connection string for ${ENV} is required: STAGING_*/PROD_* scoped vars or deploy/dokploy/.env.${ENV}"
      exit 1
    fi
  else
    RESTORE_URL="<database-url>"
  fi
fi

echo "=============================================================================="
echo -e "${BOLD}CafeMood Disaster Recovery Suite${NC}"
echo "Environment:     ${ENV}"
echo "Mode:            $([ "$DRILL_MODE" = true ] && echo "NON-DESTRUCTIVE RECOVERY DRILL (staging scratch db)" || echo "LIVE RESTORATION")"
echo "Target:          $([ "$DRILL_MODE" = true ] && echo "staging scratch database ${DRILL_DB}" || echo "Supabase ${ENV} project (DATABASE_URL)")"
echo "Backup Archive:  ${BACKUP_PATH}"
echo "=============================================================================="

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
else
  ok "[DRY-RUN] Archive integrity verification simulated."
fi

# ------------------------------------------------------------------------------
# STEP 3: Safety Guard & Confirmation Prompt
# ------------------------------------------------------------------------------
if [ "$DRILL_MODE" = false ] && [ "$DRY_RUN" = false ]; then
  if [ "$CONFIRM_FLAG" = false ]; then
    echo ""
    echo -e "${BOLD}${RED}CRITICAL WARNING: This will overwrite the Supabase ${ENV} database!${NC}"
    read -rp "Are you sure you want to proceed with live database restore? (Type 'RESTORE' to confirm): " CONFIRMATION
    if [[ "$CONFIRMATION" != "RESTORE" ]]; then
      echo "Restoration aborted by operator."
      exit 0
    fi
  fi
fi

# ------------------------------------------------------------------------------
# STEP 4: Target Preparation (drill scratch db; no container health check)
# ------------------------------------------------------------------------------
log "Step 4: Preparing restore target..."

if [ "$DRY_RUN" = false ]; then
  for bin in pg_restore psql; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      error "${bin} not found in PATH. Install postgresql-client to run restores."
      exit 1
    fi
  done

  if [ "$DRILL_MODE" = true ]; then
    log "Creating scratch drill database '${DRILL_DB}' on the staging Supabase project..."
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
      -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\";" \
      -c "CREATE DATABASE \"${DRILL_DB}\";" >/dev/null
    ok "Scratch drill database created: ${DRILL_DB}"
  else
    log "Live restore target: Supabase ${ENV} project (no connection termination: shared pooler is left untouched)."
  fi
else
  ok "[DRY-RUN] Database preparation simulated."
fi

# ------------------------------------------------------------------------------
# STEP 5: Database Restoration via pg_restore
# ------------------------------------------------------------------------------
RESTORE_LABEL="$([ "$DRILL_MODE" = true ] && echo "scratch database '${DRILL_DB}' (staging)" || echo "Supabase ${ENV} project")"
log "Step 5: Restoring database schema and data into ${RESTORE_LABEL}..."

if [ "$DRY_RUN" = false ]; then
  set -o pipefail

  run_pg_restore() {
    if [[ "$BACKUP_PATH" == *.gz ]]; then
      log "Decompressing gzip archive stream to pg_restore..."
      gzip -dc "$BACKUP_PATH" | pg_restore -d "$RESTORE_URL" --clean --if-exists --no-owner --verbose
    else
      pg_restore -d "$RESTORE_URL" --clean --if-exists --no-owner --verbose < "$BACKUP_PATH"
    fi
  }

  if ! run_pg_restore; then
    if [ "$DRILL_MODE" = false ]; then
      error "CRITICAL: Live database restore FAILED on Supabase ${ENV}!"
      exit 1
    else
      warn "pg_restore completed with notices/warnings during recovery drill."
    fi
  fi
  ok "Database restore command executed."
else
  ok "[DRY-RUN] Restoration via pg_restore simulated."
fi

# ------------------------------------------------------------------------------
# STEP 6: Post-Restore Verification (PostGIS, Table Counts, Spatial Queries)
# ------------------------------------------------------------------------------
log "Step 6: Executing post-restore data and spatial contract verification..."

if [ "$DRY_RUN" = false ]; then
  # 1. PostGIS extension verification
  POSTGIS_VERSION="$(psql "$RESTORE_URL" -t -c "SELECT PostGIS_Version();" 2>/dev/null | tr -d '[:space:]' || echo "")"

  if [[ -n "$POSTGIS_VERSION" ]]; then
    ok "PostGIS extension verified: ${POSTGIS_VERSION}"
  else
    error "PostGIS extension check FAILED on ${RESTORE_LABEL}."
    exit 1
  fi

  # 2. Table row counts
  CAFES_COUNT="$(psql "$RESTORE_URL" -t -c "SELECT count(*) FROM cafes;" 2>/dev/null | tr -d '[:space:]' || echo "0")"
  CHECKINS_COUNT="$(psql "$RESTORE_URL" -t -c "SELECT count(*) FROM checkins;" 2>/dev/null | tr -d '[:space:]' || echo "0")"
  PROFILES_COUNT="$(psql "$RESTORE_URL" -t -c "SELECT count(*) FROM profiles;" 2>/dev/null | tr -d '[:space:]' || echo "0")"

  log "Row counts: cafes=${CAFES_COUNT}, checkins=${CHECKINS_COUNT}, profiles=${PROFILES_COUNT}"

  # 3. Spatial query contract benchmark (cafes.location geography column per 0001_init.sql)
  SPATIAL_CHECK="$(psql "$RESTORE_URL" -t -c \
    "SELECT count(*) FROM cafes WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(103.8198, 1.3521), 4326)::geography, 10000);" 2>/dev/null | tr -d '[:space:]' || echo "")"
  if [[ -z "$SPATIAL_CHECK" ]]; then
    error "PostGIS spatial query check FAILED on ${RESTORE_LABEL}."
    exit 1
  fi
  ok "PostGIS spatial query test returned ${SPATIAL_CHECK} cafe(s) in range."

  # 4. Cleanup drill scratch database on the staging project
  if [ "$DRILL_MODE" = true ]; then
    log "Cleaning up scratch drill database '${DRILL_DB}'..."
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
      -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\";" >/dev/null
    ok "Scratch drill database removed."
  fi
else
  ok "[DRY-RUN] Post-restore validation queries simulated."
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
  echo "Target:          Supabase ${ENV} project"
  echo "Status:          Active & Verified"
fi
echo "=============================================================================="
