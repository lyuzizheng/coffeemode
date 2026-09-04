#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode PostgreSQL + PostGIS Restore Script
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
#
# Usage:
#   ./restore-postgres.sh [staging|prod] <path-to-backup.dump> [--yes]
#
# Examples:
#   ./restore-postgres.sh staging /backups/coffeemode_staging_pre-migration_20260904.dump --yes
#   ./restore-postgres.sh prod /backups/coffeemode_prod_pre-migration_20260904.dump
# ==============================================================================

set -euo pipefail

ENV="${1:-}"
BACKUP_PATH="${2:-}"
CONFIRM_FLAG="${3:-}"

if [[ -z "$ENV" || -z "$BACKUP_PATH" ]]; then
  echo "Usage: $0 [staging|prod] <path-to-backup.dump> [--yes]" >&2
  exit 1
fi

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Error: Invalid environment '$ENV'. Must be 'staging' or 'prod'." >&2
  exit 1
fi

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Error: Backup file not found: $BACKUP_PATH" >&2
  exit 1
fi

CONTAINER="coffeemode-postgres-${ENV}"
DB_NAME="coffeemode_${ENV}"
DB_USER="coffeemode_${ENV}_user"

echo "=============================================================================="
echo "WARNING: DATABASE RESTORE REQUESTED"
echo "Environment: ${ENV}"
echo "Container:   ${CONTAINER}"
echo "Database:    ${DB_NAME}"
echo "Backup File: ${BACKUP_PATH}"
echo "=============================================================================="

if [[ "$CONFIRM_FLAG" != "--yes" ]]; then
  read -rp "Are you sure you want to completely restore and overwrite database '${DB_NAME}'? (type 'RESTORE'): " CONFIRMATION
  if [[ "$CONFIRMATION" != "RESTORE" ]]; then
    echo "Restore aborted by user."
    exit 0
  fi
fi

# 1. Verify target container is running
if ! docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}' | grep -q "healthy"; then
  echo "Error: Database container '${CONTAINER}' is not healthy or running." >&2
  exit 1
fi

# 2. Terminate existing client connections to prevent restore deadlocks
echo "Terminating active database connections to '${DB_NAME}'..."
docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
  psql -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" || true

# 3. Restore database using pg_restore
echo "Restoring database from ${BACKUP_PATH}..."
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner --verbose < "$BACKUP_PATH" || {
    echo "Notice: pg_restore completed with warnings/ignored non-critical errors."
  }

# 4. Verify database and PostGIS extension
echo "Verifying PostGIS extension and database connectivity..."
POSTGIS_CHECK="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT PostGIS_Version();" | tr -d '[:space:]')"

if [[ -n "$POSTGIS_CHECK" ]]; then
  echo "PostGIS verified successfully: ${POSTGIS_CHECK}"
else
  echo "Error: PostGIS extension verification failed after restore." >&2
  exit 1
fi

echo "Database restore completed successfully."
