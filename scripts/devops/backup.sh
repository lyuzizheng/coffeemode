#!/usr/bin/env bash
# ==============================================================================
# CafeMood Automated Backup & R2 Replication Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Creates atomic database backups and configuration archives:
#   1. Atomic pg_dump (-Fc custom format) against DATABASE_URL (Supabase pooled,
#      sslmode=require) with gzip compression — no local container required
#   2. SHA256 checksum computation for cryptographic integrity verification
#   3. Dokploy stack configuration archiving
#   4. Cloudflare R2 offsite replication (s3://coffeemode-backups/<env>/) —
#      REQUIRED: Supabase free tier ships no automated backups, so pg_dump → R2
#      is the only offsite copy (BRAWUKA-241)
#   5. Automated retention pruning (Grandfather-Father-Son lifecycle)
#
# Database topology (BRAWUKA-240 D1 / decision 34a): the primary database lives
# in Supabase (prod project + staging project, region ap-southeast-1). There is
# no self-hosted postgres container; physical volume archiving is skipped.
#
# Usage:
#   ./backup.sh [options]
#
# Options:
#   -h, --help                Show this help message and exit
#   -e, --env <staging|prod>  Target environment (default: prod)
#   -t, --type <db|vol|full>  Backup target: db, vol (configs), or full (default: full)
#   -r, --reason <string>     Backup reason: scheduled | pre-migration | manual (default: manual)
#   -o, --output-dir <path>   Destination directory for local archives
#   --upload-r2               Force upload to Cloudflare R2 (requires R2 credentials)
#   --no-upload-r2            Disable Cloudflare R2 upload
#   --url <conn>              Explicit connection-string override (opt-in escape hatch
#                             for manual runs; bypasses per-env scoping — use with care)
#   --dry-run                 Log planned actions without modifying system state
#
# Environment (per-env only — unscoped DATABASE_URL/DIRECT_URL are NEVER read,
# so --env cannot be silently retargeted by the caller's shell, BRAWUKA-241 P0):
#   STAGING_DIRECT_URL / PROD_DIRECT_URL       Session/direct connection (preferred)
#   STAGING_DATABASE_URL / PROD_DATABASE_URL   Pooled connection (fallback)
#   deploy/dokploy/.env.<env>                  DIRECT_URL line first, then DATABASE_URL
#
# Examples:
#   ./backup.sh --env staging
#   ./backup.sh --env prod --type db --retention-days 30
#   ./backup.sh --dry-run
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
ENV="prod"
BACKUP_TYPE="full"
REASON="manual"
OUTPUT_DIR=""
RETENTION_DAYS=""
FORCE_UPLOAD_R2=false
DISABLE_UPLOAD_R2=false
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
    -t|--type)
      BACKUP_TYPE="${2:?Error: --type requires an argument (db|vol|full)}"
      shift 2
      ;;
    -r|--reason)
      REASON="${2:?Error: --reason requires an argument (scheduled|pre-migration|manual)}"
      shift 2
      ;;
    -o|--output-dir)
      OUTPUT_DIR="${2:?Error: --output-dir requires a path}"
      shift 2
      ;;
    --retention-days)
      RETENTION_DAYS="${2:?Error: --retention-days requires an integer}"
      shift 2
      ;;
    --upload-r2)
      FORCE_UPLOAD_R2=true
      shift
      ;;
    --no-upload-r2)
      DISABLE_UPLOAD_R2=true
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
    scheduled|pre-migration|manual)
      REASON="$1"
      shift
      ;;
    *)
      echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Error: Invalid environment '$ENV'. Must be 'staging' or 'prod'." >&2
  exit 1
fi

# Set default retention days if unspecified
if [[ -z "$RETENTION_DAYS" ]]; then
  if [[ "$ENV" == "staging" ]]; then
    RETENTION_DAYS=7
  else
    RETENTION_DAYS=14
  fi
fi

# Determine default backup directory (local repo dir; legacy docker volume path
# removed with the self-hosted postgres topology, BRAWUKA-241)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="${REPO_ROOT}/backups/${ENV}"
fi

TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"

# Resolve the Supabase connection string for --env (per-env only).
# Precedence: --url override > <ENV>_DIRECT_URL > <ENV>_DATABASE_URL >
# deploy/dokploy/.env.<env> (DIRECT_URL line first, then DATABASE_URL).
# Unscoped ambient DATABASE_URL/DIRECT_URL are NEVER consulted (BRAWUKA-241 P0):
# the shell's exported URL must not silently retarget --env.
# pg_dump opens a single session (never add -j/parallel against the pooler).
resolve_database_url() {
  if [[ -n "$URL_OVERRIDE" ]]; then
    printf '%s' "$URL_OVERRIDE"
    return 0
  fi
  local prefix
  if [[ "$ENV" == "staging" ]]; then prefix="STAGING"; else prefix="PROD"; fi
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
  local env_file="${REPO_ROOT}/deploy/dokploy/.env.${ENV}"
  if [[ -f "$env_file" ]]; then
    local url
    url="$(grep -E '^DIRECT_URL=' "$env_file" | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
    if [[ -z "$url" ]]; then
      url="$(grep -E '^DATABASE_URL=' "$env_file" | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
    fi
    if [[ -n "$url" ]]; then
      printf '%s' "$url"
      return 0
    fi
  fi
  return 1
}

# Logging Utilities
# ------------------------------------------------------------------------------
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BOLD}${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${BOLD}${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${BOLD}${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${BOLD}${RED}[ERROR]${NC} $*" >&2; }

echo "=============================================================================="
echo "CafeMood Automated Backup Suite"
echo "Environment:     ${ENV}"
echo "Backup Type:     ${BACKUP_TYPE}"
echo "Reason:          ${REASON}"
echo "Database:        Supabase ${ENV} project (DATABASE_URL, sslmode=require)"
echo "Destination Dir: ${OUTPUT_DIR}"
echo "Retention Days:  ${RETENTION_DAYS}"
echo "Timestamp (UTC): ${TIMESTAMP}"
echo "=============================================================================="

BACKUP_DB_URL=""
if [ "$DRY_RUN" = false ]; then
  if ! BACKUP_DB_URL="$(resolve_database_url)"; then
    echo "Error: per-env connection for ${ENV} is required: STAGING_*/PROD_* scoped vars, --url override, or deploy/dokploy/.env.${ENV}" >&2
    exit 1
  fi
fi

if [ "$DRY_RUN" = false ]; then
  mkdir -p "$OUTPUT_DIR"
fi

# ------------------------------------------------------------------------------
# STEP 1: PostgreSQL Atomic Database Dump
# ------------------------------------------------------------------------------
DB_DUMP_FILE=""
DB_CHECKSUM_FILE=""

if [[ "$BACKUP_TYPE" == "db" || "$BACKUP_TYPE" == "full" ]]; then
  log "Step 1: Executing PostgreSQL atomic database backup with GFS retention tier..."

  # Determine GFS retention tier based on UTC calendar day
  DAY_OF_MONTH="$(date -u +"%d")"
  DAY_OF_WEEK="$(date -u +"%u")" # 7 is Sunday
  if [[ "$DAY_OF_MONTH" == "01" ]]; then
    GFS_TIER="monthly"
  elif [[ "$DAY_OF_WEEK" == "7" ]]; then
    GFS_TIER="weekly"
  else
    GFS_TIER="daily"
  fi

  DB_FILENAME="coffeemode_${ENV}_${REASON}_${GFS_TIER}_${TIMESTAMP}.dump.gz"
  DB_TEMP_PATH="${OUTPUT_DIR}/.tmp_${DB_FILENAME}"
  DB_DUMP_FILE="${OUTPUT_DIR}/${DB_FILENAME}"
  DB_CHECKSUM_FILE="${DB_DUMP_FILE}.sha256"

  if [ "$DRY_RUN" = false ]; then
    if ! command -v pg_dump >/dev/null 2>&1; then
      error "pg_dump not found in PATH. Install postgresql-client to run backups."
      exit 1
    fi

    # Execute pg_dump (-Fc) against the Supabase connection string piped to gzip.
    # Single session only — never pass parallel (-j) flags against the pooler.
    log "Streaming compressed pg_dump from Supabase ${ENV} (Tier: ${GFS_TIER})..."
    set -o pipefail
    pg_dump "$BACKUP_DB_URL" -Fc --verbose | gzip -9 > "$DB_TEMP_PATH"

    # Verify non-empty size and atomically move into place
    if [[ ! -s "$DB_TEMP_PATH" ]]; then
      error "Backup file is empty or was not created: ${DB_TEMP_PATH}"
      rm -f "$DB_TEMP_PATH"
      exit 1
    fi
    mv "$DB_TEMP_PATH" "$DB_DUMP_FILE"

    # Generate SHA256 checksum for tamper-proof verification
    (cd "$OUTPUT_DIR" && sha256sum "$DB_FILENAME" > "${DB_FILENAME}.sha256")
    FILE_SIZE="$(du -h "$DB_DUMP_FILE" | cut -f1)"
    ok "Database backup successfully created (${FILE_SIZE}, Tier: ${GFS_TIER}): ${DB_DUMP_FILE}"
    ok "SHA256 checksum: $(cat "$DB_CHECKSUM_FILE")"
  else
    ok "[DRY-RUN] Database backup creation (${DB_FILENAME}, Tier: ${GFS_TIER}) simulated."
  fi
fi


# ------------------------------------------------------------------------------
# STEP 2: Configuration Archiving
#
# NOTE: The self-hosted postgres data volume no longer exists (Supabase primary,
# BRAWUKA-241). Physical volume tar is intentionally skipped; the pg_dump in
# Step 1 plus the Dokploy/script config archive below are the full backup set.
# ------------------------------------------------------------------------------
VOL_ARCHIVE_FILE=""
VOL_CHECKSUM_FILE=""
DATA_ARCHIVE_FILE=""
DATA_CHECKSUM_FILE=""

if [[ "$BACKUP_TYPE" == "vol" || "$BACKUP_TYPE" == "full" ]]; then
  log "Step 2: Archiving Dokploy configuration..."

  VOL_FILENAME="coffeemode_${ENV}_config_${TIMESTAMP}.tar.gz"
  VOL_ARCHIVE_FILE="${OUTPUT_DIR}/${VOL_FILENAME}"
  VOL_CHECKSUM_FILE="${VOL_ARCHIVE_FILE}.sha256"

  if [ "$DRY_RUN" = false ]; then
    tar -czf "$VOL_ARCHIVE_FILE" -C "${REPO_ROOT}" \
      "deploy/dokploy" \
      "scripts/devops" 2>/dev/null || true

    (cd "$OUTPUT_DIR" && sha256sum "$VOL_FILENAME" > "${VOL_FILENAME}.sha256")
    VOL_SIZE="$(du -h "$VOL_ARCHIVE_FILE" | cut -f1)"
    ok "Configuration archive created (${VOL_SIZE}): ${VOL_ARCHIVE_FILE}"
  else
    ok "[DRY-RUN] Configuration archive creation simulated."
  fi
fi
# ------------------------------------------------------------------------------
R2_BUCKET="${R2_BACKUP_BUCKET:-coffeemode-backups}"

should_upload_r2() {
  if [ "$DISABLE_UPLOAD_R2" = true ]; then
    return 1
  fi
  if [ "$FORCE_UPLOAD_R2" = true ]; then
    return 0
  fi
  # Auto-enable if credentials are set
  if [[ -n "${R2_ACCESS_KEY_ID:-}" && -n "${R2_SECRET_ACCESS_KEY:-}" && -n "${R2_ENDPOINT:-}" ]]; then
    return 0
  fi
  return 1
}

if should_upload_r2; then
  log "Step 3: Offsite replication to Cloudflare R2 bucket 's3://${R2_BUCKET}/${ENV}/'..."
  if [ "$DRY_RUN" = false ]; then
    if command -v aws >/dev/null 2>&1; then
      AWS_ENV=(
        AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
        AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"
      )

      # Upload DB dump & checksum
      if [[ -n "$DB_DUMP_FILE" && -f "$DB_DUMP_FILE" ]]; then
        log "Uploading database dump to Cloudflare R2..."
        env "${AWS_ENV[@]}" aws s3 cp "$DB_DUMP_FILE" "s3://${R2_BUCKET}/${ENV}/${DB_FILENAME}" \
          --endpoint-url "${R2_ENDPOINT}"
        env "${AWS_ENV[@]}" aws s3 cp "$DB_CHECKSUM_FILE" "s3://${R2_BUCKET}/${ENV}/${DB_FILENAME}.sha256" \
          --endpoint-url "${R2_ENDPOINT}"
      fi

      # Upload volume archive & checksum
      if [[ -n "$VOL_ARCHIVE_FILE" && -f "$VOL_ARCHIVE_FILE" ]]; then
        log "Uploading config archive to Cloudflare R2..."
        env "${AWS_ENV[@]}" aws s3 cp "$VOL_ARCHIVE_FILE" "s3://${R2_BUCKET}/${ENV}/${VOL_FILENAME}" \
          --endpoint-url "${R2_ENDPOINT}"
        env "${AWS_ENV[@]}" aws s3 cp "$VOL_CHECKSUM_FILE" "s3://${R2_BUCKET}/${ENV}/${VOL_FILENAME}.sha256" \
          --endpoint-url "${R2_ENDPOINT}"
      fi

      ok "Offsite Cloudflare R2 upload complete."
    else
      warn "'aws' CLI tool not found on host. Skipping R2 offsite upload."
    fi
  else
    ok "[DRY-RUN] Cloudflare R2 offsite replication simulated."
  fi
else
  log "Step 3: Cloudflare R2 offsite upload skipped (no credentials or --no-upload-r2)."
fi

# ------------------------------------------------------------------------------
# STEP 4: Automated Retention Pruning
# ------------------------------------------------------------------------------
log "Step 4: Executing Grandfather-Father-Son retention lifecycle pruning in ${OUTPUT_DIR}..."
if [ "$DRY_RUN" = false ]; then
  PRUNED_COUNT=0

  # 1. Prune daily backups older than RETENTION_DAYS (default 7/14 days)
  while IFS= read -r old_file; do
    if [[ -n "$old_file" ]]; then
      rm -f "$old_file" "${old_file}.sha256"
      PRUNED_COUNT=$((PRUNED_COUNT + 1))
    fi
  done < <(find "$OUTPUT_DIR" -name "coffeemode_${ENV}_*daily_*.dump.gz" -type f -mtime "+${RETENTION_DAYS}" 2>/dev/null || true)

  # 2. Prune weekly backups older than 28 days (4 weeks)
  while IFS= read -r old_file; do
    if [[ -n "$old_file" ]]; then
      rm -f "$old_file" "${old_file}.sha256"
      PRUNED_COUNT=$((PRUNED_COUNT + 1))
    fi
  done < <(find "$OUTPUT_DIR" -name "coffeemode_${ENV}_*weekly_*.dump.gz" -type f -mtime +28 2>/dev/null || true)

  # 3. Prune monthly backups older than 90 days (3 months)
  while IFS= read -r old_file; do
    if [[ -n "$old_file" ]]; then
      rm -f "$old_file" "${old_file}.sha256"
      PRUNED_COUNT=$((PRUNED_COUNT + 1))
    fi
  done < <(find "$OUTPUT_DIR" -name "coffeemode_${ENV}_*monthly_*.dump.gz" -type f -mtime +90 2>/dev/null || true)

  # 4. Prune unclassified legacy dumps older than RETENTION_DAYS
  while IFS= read -r old_file; do
    if [[ -n "$old_file" ]]; then
      rm -f "$old_file" "${old_file}.sha256"
      PRUNED_COUNT=$((PRUNED_COUNT + 1))
    fi
  done < <(find "$OUTPUT_DIR" -name "coffeemode_${ENV}_*.dump.gz" ! -name "*weekly*" ! -name "*monthly*" ! -name "*daily*" -type f -mtime "+${RETENTION_DAYS}" 2>/dev/null || true)

  # 5. Prune volume and config archives older than RETENTION_DAYS
  while IFS= read -r old_file; do
    if [[ -n "$old_file" ]]; then
      rm -f "$old_file" "${old_file}.sha256"
      PRUNED_COUNT=$((PRUNED_COUNT + 1))
    fi
  done < <(find "$OUTPUT_DIR" -name "coffeemode_${ENV}_*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" 2>/dev/null || true)

  ok "Pruned ${PRUNED_COUNT} expired archive(s) per GFS lifecycle policy."
else
  ok "[DRY-RUN] GFS retention pruning simulated (Daily: ${RETENTION_DAYS}d, Weekly: 28d, Monthly: 90d)."
fi

echo ""
echo "=============================================================================="
echo -e "${BOLD}${GREEN}Backup Workflow Completed Successfully!${NC}"
echo "=============================================================================="
echo "Database Archive:  ${DB_DUMP_FILE:-None}"
echo "Checksum:          ${DB_CHECKSUM_FILE:-None}"
echo "Config Archive:    ${VOL_ARCHIVE_FILE:-None}"
echo "Retention Policy:  ${RETENTION_DAYS} days local retention"
echo "=============================================================================="
