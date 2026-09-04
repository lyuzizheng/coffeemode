#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Deployment & Release Orchestrator
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
#
# Concrete executor for deployment workflow:
#   1. Executes pre-migration PostgreSQL backup
#   2. Applies database migrations (web/scripts/migrate.mjs)
#   3. Triggers Dokploy deployment webhook (or compose rolling update)
#   4. Executes post-deployment smoke test suite
#
# Usage:
#   ./deploy-release.sh [staging|prod]
#
# Environment variables:
#   DOKPLOY_DEPLOY_URL    (optional: webhook URL to trigger Dokploy build)
#   DOKPLOY_DEPLOY_TOKEN  (optional: bearer token for Dokploy webhook)
#   DATABASE_URL          (required for migrations if not running via compose)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV="${1:-staging}"

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Error: Invalid environment '$ENV'. Must be 'staging' or 'prod'." >&2
  exit 1
fi

echo "=============================================================================="
echo "Starting CoffeeMode Release Pipeline"
echo "Target Environment: ${ENV}"
echo "Date (UTC):         $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=============================================================================="

# STEP 1: Mandatory pre-migration backup
echo "[STEP 1/4] Executing pre-migration database snapshot..."
"${SCRIPT_DIR}/backup-postgres.sh" "$ENV" pre-migration

# STEP 2: Apply database schema migrations
echo "[STEP 2/4] Executing database schema migrations..."
CONTAINER="coffeemode-postgres-${ENV}"
DB_USER="coffeemode_${ENV}_user"
DB_NAME="coffeemode_${ENV}"

if docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}' | grep -q "healthy"; then
  echo "Target database '${CONTAINER}' is healthy. Applying migrations..."
  # If running from repo root or CI
  if [[ -f "${SCRIPT_DIR}/../../web/scripts/migrate.mjs" ]]; then
    (cd "${SCRIPT_DIR}/../../web" && npm run db:migrate)
  elif docker ps --filter "name=^/coffeemode-web-${ENV}$" --format '{{.Status}}' | grep -q "Up"; then
    docker exec "coffeemode-web-${ENV}" npm run db:migrate
  else
    echo "Notice: Web container not running. Migrations will run upon container initialization."
  fi
else
  echo "Error: Database container '${CONTAINER}' is not running or healthy." >&2
  exit 1
fi

# STEP 3: Deploy updated container
echo "[STEP 3/4] Triggering deployment..."
if [[ -n "${DOKPLOY_DEPLOY_URL:-}" ]]; then
  echo "Calling Dokploy deployment webhook: ${DOKPLOY_DEPLOY_URL}..."
  AUTH_HEADER=()
  if [[ -n "${DOKPLOY_DEPLOY_TOKEN:-}" ]]; then
    AUTH_HEADER=(-H "Authorization: Bearer ${DOKPLOY_DEPLOY_TOKEN}")
  fi
  curl -fsS -X POST "${AUTH_HEADER[@]}" "${DOKPLOY_DEPLOY_URL}"
  echo "Dokploy deploy webhook triggered successfully."
else
  echo "DOKPLOY_DEPLOY_URL not provided. Executing local Docker Compose deploy..."
  COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.${ENV}.yml"
  docker compose -f "$COMPOSE_FILE" up -d --build
fi

# STEP 4: Post-deployment smoke test verification
echo "[STEP 4/4] Executing automated smoke tests..."
# Brief grace period for container startup and healthcheck readiness
sleep 5
"${SCRIPT_DIR}/smoke-test.sh" "$ENV"

echo "=============================================================================="
echo "Release pipeline completed successfully for ${ENV}."
echo "=============================================================================="
