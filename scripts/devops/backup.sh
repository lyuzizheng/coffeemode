#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Automated Backup & R2 Replication Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Creates atomic database backups and persistent volume archives:
#   1. Container health verification (coffeemode-postgres-staging / prod)
#   2. Atomic pg_dump (-Fc custom format) with gzip compression
#   3. SHA256 checksum computation for cryptographic integrity verification
#   4. Volume & Dokploy stack configuration archiving
#   5. Cloudflare R2 offsite replication (s3://coffeemode-backups/<env>/)
#   6. Automated retention pruning (Grandfather-Father-Son lifecycle)
#
# Usage:
#   ./backup.sh [options]
#
# Options:
#   -h, --help                Show this help message and exit
#   -e, --env <staging|prod>  Target environment (default: prod)
#   -t, --type <db|vol|full>  Backup target: db, vol (volumes), or full (default: full)
#   -r, --reason <string>     Backup reason: scheduled | pre-migration | manual (default: manual)
#   -o, --output-dir <path>   Destination directory for local archives
#   --retention-days <days>   Local retention threshold in days (default: 14 for prod, 7 for staging)
#   --upload-r2               Force upload to Cloudflare R2 (requires R2 credentials)
#   --no-upload-r2            Disable Cloudflare R2 upload
#   --dry-run                 Log planned actions without modifying system state
#
# Examples:
#   ./backup.sh --env staging
#   ./backup.sh --env prod --reason pre-migration
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

# Determine default backup directory
if [[ -z "$OUTPUT_DIR" ]]; then
  DEFAULT_VOL_DIR="/var/lib/docker/volumes/coffeemode_postgres_${ENV}_backups/_data"
  if [[ -d "$DEFAULT_VOL_DIR" && -w "$DEFAULT_VOL_DIR" ]]; then
    OUTPUT_DIR="$DEFAULT_VOL_DIR"
  else
    OUTPUT_DIR="${REPO_ROOT}/backups/${ENV}"
  fi
fi

TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
CONTAINER="coffeemode-postgres-${ENV}"
DB_NAME="coffeemode_${ENV}"
DB_USER="coffeemode_${ENV}_user"

# ------------------------------------------------------------------------------
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
echo "CoffeeMode Automated Backup Suite"
echo "Environment:     ${ENV}"
echo "Backup Type:     ${BACKUP_TYPE}"
echo "Reason:          ${REASON}"
echo "Container:       ${CONTAINER}"
echo "Destination Dir: ${OUTPUT_DIR}"
echo "Retention Days:  ${RETENTION_DAYS}"
echo "Timestamp (UTC): ${TIMESTAMP}"
echo "=============================================================================="

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

  # Resolve and validate database password
  if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
    if [[ -f "${REPO_ROOT}/deploy/dokploy/.env.${ENV}" ]]; then
      POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "${REPO_ROOT}/deploy/dokploy/.env.${ENV}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
    fi
  fi
  if [ "$DRY_RUN" = false ]; then
    : "${POSTGRES_PASSWORD:?Error: POSTGRES_PASSWORD must be set in environment or deploy/dokploy/.env.${ENV}}"
  fi

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
    # 1. Verify container is healthy
    if ! docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}' | grep -q "healthy"; then
      error "Database container '${CONTAINER}' is not healthy or running."
      exit 1
    fi

    # 2. Execute pg_dump with custom format (-Fc) piped to gzip
    log "Streaming compressed pg_dump from container '${CONTAINER}' (Tier: ${GFS_TIER})..."
    set -o pipefail
    docker exec -e PGPASSWORD="${POSTGRES_PASSWORD}" "$CONTAINER" \
      pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --verbose | gzip -9 > "$DB_TEMP_PATH"

    # 3. Verify non-empty size and atomically move into place
    if [[ ! -s "$DB_TEMP_PATH" ]]; then
      error "Backup file is empty or was not created: ${DB_TEMP_PATH}"
      rm -f "$DB_TEMP_PATH"
      exit 1
    fi
    mv "$DB_TEMP_PATH" "$DB_DUMP_FILE"

    # 4. Generate SHA256 checksum for tamper-proof verification
    (cd "$OUTPUT_DIR" && sha256sum "$DB_FILENAME" > "${DB_FILENAME}.sha256")
    FILE_SIZE="$(du -h "$DB_DUMP_FILE" | cut -f1)"
    ok "Database backup successfully created (${FILE_SIZE}, Tier: ${GFS_TIER}): ${DB_DUMP_FILE}"
    ok "SHA256 checksum: $(cat "$DB_CHECKSUM_FILE")"
  else
    ok "[DRY-RUN] Database backup creation (${DB_FILENAME}, Tier: ${GFS_TIER}) simulated."
  fi
fi

# ------------------------------------------------------------------------------
# STEP 2: Volume & Configuration Archiving
# ------------------------------------------------------------------------------
VOL_ARCHIVE_FILE=""
VOL_CHECKSUM_FILE=""
DATA_ARCHIVE_FILE=""
DATA_CHECKSUM_FILE=""

if [[ "$BACKUP_TYPE" == "vol" || "$BACKUP_TYPE" == "full" ]]; then
  log "Step 2: Archiving persistent volumes and Dokploy configuration..."

  # 2a. Archive Docker persistent data volume if available
  DOCKER_VOL="coffeemode_postgres_${ENV}_data"
  DATA_FILENAME="coffeemode_${ENV}_volumedata_${TIMESTAMP}.tar.gz"
  DATA_ARCHIVE_FILE="${OUTPUT_DIR}/${DATA_FILENAME}"
  DATA_CHECKSUM_FILE="${DATA_ARCHIVE_FILE}.sha256"

  if [ "$DRY_RUN" = false ]; then
    if docker volume inspect "$DOCKER_VOL" >/dev/null 2>&1; then
      log "Archiving Docker persistent volume '${DOCKER_VOL}'..."
      docker run --rm \
        -v "${DOCKER_VOL}:/volume-data:ro" \
        -v "${OUTPUT_DIR}:/backup-dest" \
        alpine tar -czf "/backup-dest/${DATA_FILENAME}" -C /volume-data .
      (cd "$OUTPUT_DIR" && sha256sum "$DATA_FILENAME" > "${DATA_FILENAME}.sha256")
      VOL_DATA_SIZE="$(du -h "$DATA_ARCHIVE_FILE" | cut -f1)"
      ok "Persistent volume archive created (${VOL_DATA_SIZE}): ${DATA_ARCHIVE_FILE}"
    else
      warn "Docker volume '${DOCKER_VOL}' not found. Skipping physical volume tar."
    fi
  else
    ok "[DRY-RUN] Docker volume '${DOCKER_VOL}' archiving simulated."
  fi

  # 2b. Archive deploy configs and environment templates
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
# STEP 3: Cloudflare R2 Offsite Replication
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
