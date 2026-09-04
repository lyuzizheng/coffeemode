#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode PostgreSQL + PostGIS Backup Script
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
#
# Usage:
#   ./backup-postgres.sh [staging|prod] [pre-migration|scheduled]
#
# Examples:
#   ./backup-postgres.sh prod pre-migration
#   ./backup-postgres.sh staging scheduled
# ==============================================================================

set -euo pipefail

ENV="${1:-prod}"
REASON="${2:-scheduled}"
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Error: Invalid environment '$ENV'. Must be 'staging' or 'prod'." >&2
  exit 1
fi

CONTAINER="coffeemode-postgres-${ENV}"
DB_NAME="coffeemode_${ENV}"
DB_USER="coffeemode_${ENV}_user"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/docker/volumes/coffeemode_postgres_${ENV}_backups/_data}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ "$ENV" == "staging" ]]; then
  RETENTION_DAYS=7
fi

# Ensure local backup directory exists
mkdir -p "$BACKUP_DIR"

BACKUP_FILENAME="coffeemode_${ENV}_${REASON}_${TIMESTAMP}.dump"
BACKUP_FILEPATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

echo "=============================================================================="
echo "Starting PostgreSQL backup"
echo "Environment: ${ENV}"
echo "Container:   ${CONTAINER}"
echo "Database:    ${DB_NAME}"
echo "Reason:      ${REASON}"
echo "Destination: ${BACKUP_FILEPATH}"
echo "=============================================================================="

# 1. Verify target container is running and healthy
if ! docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}' | grep -q "healthy"; then
  echo "Error: Database container '${CONTAINER}' is not healthy or running." >&2
  exit 1
fi

# 2. Execute pg_dump inside container using PostgreSQL custom archive format (-Fc)
# Custom format (-Fc) includes PostGIS geometries, tables, indexes, and enables parallel pg_restore.
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --verbose > "$BACKUP_FILEPATH"

# 3. Validate backup integrity & non-empty size
if [[ ! -s "$BACKUP_FILEPATH" ]]; then
  echo "Error: Backup file is empty or was not created: ${BACKUP_FILEPATH}" >&2
  rm -f "$BACKUP_FILEPATH"
  exit 1
fi

FILE_SIZE="$(du -h "$BACKUP_FILEPATH" | cut -f1)"
echo "Backup successfully created (${FILE_SIZE}): ${BACKUP_FILEPATH}"

# 4. Optional: Upload to Cloudflare R2 backup bucket if credentials exist
if [[ -n "${R2_BACKUP_BUCKET:-}" && -n "${R2_ACCESS_KEY_ID:-}" && -n "${R2_SECRET_ACCESS_KEY:-}" && -n "${R2_ENDPOINT:-}" ]]; then
  echo "Mirroring backup to Cloudflare R2 bucket: ${R2_BACKUP_BUCKET}..."
  if command -v aws >/dev/null 2>&1; then
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp "$BACKUP_FILEPATH" "s3://${R2_BACKUP_BUCKET}/${ENV}/${BACKUP_FILENAME}" \
      --endpoint-url "$R2_ENDPOINT"
    echo "R2 upload complete."
  else
    echo "Notice: 'aws' CLI not installed on host. Skipping R2 offsite upload."
  fi
fi

# 5. Prune local backups older than retention window
echo "Pruning local ${ENV} backups older than ${RETENTION_DAYS} days in ${BACKUP_DIR}..."
find "$BACKUP_DIR" -name "coffeemode_${ENV}_*.dump" -type f -mtime "+${RETENTION_DAYS}" -print -delete || true

echo "Backup workflow complete."
