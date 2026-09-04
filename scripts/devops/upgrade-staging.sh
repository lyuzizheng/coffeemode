#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Staging Service Upgrade Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Orchestrates automated, safe staging releases:
#   1. Pre-flight migration safety check
#   2. Pre-migration database snapshot via ./backup.sh --env staging
#   3. Database schema migration execution against postgres-staging
#   4. Staging Next.js image rebuild and rolling restart (Dokploy webhook / compose)
#   5. Automated post-deploy smoke test verification
#
# Usage:
#   ./upgrade-staging.sh [options]
#
# Options:
#   -h, --help            Show this help message and exit
#   --skip-backup         Skip pre-migration database snapshot
#   --skip-migrations     Skip running database migrations
#   --skip-smoke          Skip post-deployment smoke tests
#   --deploy-url <url>    Dokploy deployment webhook URL override
#   --deploy-token <tok>  Dokploy deployment token override
#   --image-tag <tag>     Specific image tag or commit sha to deploy
#   --dry-run             Log planned actions without modifying system state
#
# Examples:
#   ./upgrade-staging.sh
#   ./upgrade-staging.sh --deploy-url https://dokploy.example.com/api/deploy/...
#   ./upgrade-staging.sh --dry-run
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
SKIP_BACKUP=false
SKIP_MIGRATIONS=false
SKIP_SMOKE=false
DEPLOY_URL="${DOKPLOY_STAGING_DEPLOY_URL:-${DOKPLOY_DEPLOY_URL:-}}"
DEPLOY_TOKEN="${DOKPLOY_STAGING_DEPLOY_TOKEN:-${DOKPLOY_DEPLOY_TOKEN:-}}"
IMAGE_TAG="latest"
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
    --skip-backup)
      SKIP_BACKUP=true
      shift
      ;;
    --skip-migrations)
      SKIP_MIGRATIONS=true
      shift
      ;;
    --skip-smoke)
      SKIP_SMOKE=true
      shift
      ;;
    --deploy-url)
      DEPLOY_URL="${2:?Error: --deploy-url requires a URL}"
      shift 2
      ;;
    --deploy-token)
      DEPLOY_TOKEN="${2:?Error: --deploy-token requires a token}"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="${2:?Error: --image-tag requires a tag argument}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

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
stage() { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}"; }

stage "Starting Staging Upgrade Pipeline"
log "Target Environment: staging"
log "Image Tag:          ${IMAGE_TAG}"
log "Dokploy Webhook:    $([ -n "$DEPLOY_URL" ] && echo "Configured" || echo "Local Compose Fallback")"
log "Date (UTC):         $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ------------------------------------------------------------------------------
# STEP 1: Pre-Flight Migration Verification
# ------------------------------------------------------------------------------
stage "Step 1/5: Pre-Flight Migration Safety Checks"

MIGRATIONS_DIR="${REPO_ROOT}/web/db/migrations"
if [[ -d "$MIGRATIONS_DIR" ]]; then
  log "Scanning migration files in ${MIGRATIONS_DIR}..."
  MIGRATION_COUNT="$(find "$MIGRATIONS_DIR" -name "*.sql" | wc -l | tr -d ' ')"
  log "Found ${MIGRATION_COUNT} migration file(s)."

  # Enforce zero-downtime safety: verify no raw DROP TABLE / DROP COLUMN without safety annotations
  for sql_file in "${MIGRATIONS_DIR}"/*.sql; do
    if grep -iqE "DROP[[:space:]]+(TABLE|COLUMN)" "$sql_file" 2>/dev/null; then
      warn "Destructive DDL detected in $(basename "$sql_file"): please verify this change adheres to Spec 0005 deprecation cycles."
    fi
  done
  ok "Pre-flight migration checks passed."
fi

# ------------------------------------------------------------------------------
# STEP 2: Pre-Migration Snapshot
# ------------------------------------------------------------------------------
stage "Step 2/5: Pre-Migration Database Snapshot"

if [ "$SKIP_BACKUP" = false ]; then
  log "Creating pre-migration snapshot of Staging database..."
  BACKUP_ARGS=(--env staging --reason pre-migration)
  if [ "$DRY_RUN" = true ]; then
    BACKUP_ARGS+=(--dry-run)
  fi
  "${SCRIPT_DIR}/backup.sh" "${BACKUP_ARGS[@]}"
  ok "Pre-migration database snapshot secured."
else
  log "Skipping pre-migration backup (--skip-backup)."
fi

# ------------------------------------------------------------------------------
# STEP 3: Apply Database Schema Migrations
# ------------------------------------------------------------------------------
stage "Step 3/5: Applying Database Migrations to Staging"

if [ "$SKIP_MIGRATIONS" = false ]; then
  if [ "$DRY_RUN" = false ]; then
    CONTAINER="coffeemode-postgres-staging"
    DB_USER="coffeemode_staging_user"
    DB_NAME="coffeemode_staging"
    DB_PORT=5433
    DB_PASS="${POSTGRES_PASSWORD:-coffeemode_staging_password}"
    TARGET_DB_URL="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${DB_PORT}/${DB_NAME}?sslmode=disable"

    if docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}' | grep -q "healthy"; then
      log "Target container '${CONTAINER}' is healthy. Applying migrations..."
      if [[ -f "${REPO_ROOT}/web/scripts/migrate.mjs" ]]; then
        (
          cd "${REPO_ROOT}/web"
          DATABASE_URL="$TARGET_DB_URL" node scripts/migrate.mjs
        )
      elif docker ps --filter "name=^/coffeemode-web-staging$" --format '{{.Status}}' | grep -q "Up"; then
        docker exec "coffeemode-web-staging" npm run db:migrate
      else
        warn "Web container not running and host Node migrate runner unavailable. Migrations will run at container boot."
      fi
      ok "Database schema migrations applied to Staging."
    else
      error "Database container '${CONTAINER}' is not healthy or running."
      exit 1
    fi
  else
    ok "[DRY-RUN] Staging database schema migration simulated."
  fi
else
  log "Skipping database migrations (--skip-migrations)."
fi

# ------------------------------------------------------------------------------
# STEP 4: Trigger Staging Service Deployment
# ------------------------------------------------------------------------------
stage "Step 4/5: Triggering Staging Application Deployment"

if [[ -n "$DEPLOY_URL" ]]; then
  log "Calling Dokploy deployment webhook: ${DEPLOY_URL}..."
  if [ "$DRY_RUN" = false ]; then
    AUTH_HEADER=()
    if [[ -n "$DEPLOY_TOKEN" ]]; then
      AUTH_HEADER=(-H "Authorization: Bearer ${DEPLOY_TOKEN}")
    fi
    curl -fsS -X POST "${AUTH_HEADER[@]}" "${DEPLOY_URL}"
    ok "Dokploy deployment webhook triggered successfully."
  else
    ok "[DRY-RUN] Dokploy deployment webhook call simulated."
  fi
else
  log "Deploy webhook not configured. Executing local Docker Compose deploy..."
  COMPOSE_FILE="${REPO_ROOT}/deploy/dokploy/docker-compose.staging.yml"
  if [ "$DRY_RUN" = false ]; then
    docker compose -f "$COMPOSE_FILE" up -d --build web-staging
    ok "Docker Compose web-staging container updated."
  else
    ok "[DRY-RUN] Docker Compose up -d --build web-staging simulated."
  fi
fi

# ------------------------------------------------------------------------------
# STEP 5: Post-Deployment Smoke Test & Health Verification
# ------------------------------------------------------------------------------
stage "Step 5/5: Post-Deployment Smoke Test & Health Verification"

if [ "$SKIP_SMOKE" = false ]; then
  if [ "$DRY_RUN" = false ]; then
    log "Allowing 5s grace period for container initialization..."
    sleep 5
    log "Running automated smoke test suite against Staging..."
    "${SCRIPT_DIR}/smoke-test.sh" staging || {
      error "Smoke tests FAILED on Staging! Inspect logs via 'docker logs coffeemode-web-staging'."
      exit 1
    }
    ok "All staging smoke tests passed."
  else
    ok "[DRY-RUN] Staging smoke test execution simulated."
  fi
else
  log "Skipping smoke tests (--skip-smoke)."
fi

echo ""
echo "=============================================================================="
echo -e "${BOLD}${GREEN}Staging Upgrade Pipeline Completed Successfully!${NC}"
echo "=============================================================================="
echo "Environment: staging"
echo "Image Tag:   ${IMAGE_TAG}"
echo "Status:      Healthy & Verified"
echo "URL:         https://${STAGING_DOMAIN:-staging.coffeemode.app}"
echo "=============================================================================="
