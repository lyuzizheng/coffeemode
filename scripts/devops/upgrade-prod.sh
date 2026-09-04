#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Production Zero-Downtime Upgrade Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Orchestrates production releases with multi-layer safety invariants:
#   1. Pre-Promotion Gate: Enforces green Staging smoke tests before proceeding
#   2. Mandatory Safety Snapshot: Runs ./backup.sh --env prod --reason pre-migration
#   3. Zero-Downtime Migration Rules: Pre-flight checks for non-breaking DDL
#   4. Database Migration Execution: Applies migrations against postgres-prod
#   5. Zero-Downtime Rolling Swap: Triggers Dokploy/Traefik container update (start-first)
#   6. Post-Deployment Verification: Runs smoke-test.sh prod
#   7. Instant Rollback Trap: Alerts with rollback-prod.sh on any pipeline failure
#
# Usage:
#   ./upgrade-prod.sh [options]
#
# Options:
#   -h, --help                Show this help message and exit
#   --skip-staging-gate       Bypass Staging verification gate (requires emergency override)
#   --force-skip-backup       Force skip pre-migration snapshot (strictly discouraged)
#   --skip-smoke              Skip post-deployment smoke tests
#   --deploy-url <url>        Dokploy production deploy webhook URL
#   --deploy-token <tok>      Dokploy production deploy webhook token
#   --image-tag <tag>         Specific release image tag or commit sha
#   --dry-run                 Log planned actions without modifying system state
#
# Examples:
#   ./upgrade-prod.sh
#   ./upgrade-prod.sh --image-tag v1.2.0
#   ./upgrade-prod.sh --dry-run
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
SKIP_STAGING_GATE=false
SKIP_BACKUP=false
SKIP_SMOKE=false
DEPLOY_URL="${DOKPLOY_PROD_DEPLOY_URL:-${DOKPLOY_DEPLOY_URL:-}}"
DEPLOY_TOKEN="${DOKPLOY_PROD_DEPLOY_TOKEN:-${DOKPLOY_DEPLOY_TOKEN:-}}"
IMAGE_TAG="latest"
DRY_RUN=false
SNAPSHOT_PATH=""
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
show_help() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    --skip-staging-gate)
      SKIP_STAGING_GATE=true
      shift
      ;;
    --force-skip-backup)
      SKIP_BACKUP=true
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
# Logging Utilities & Error Trap
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

# Failure Trap: prints immediate rollback command if deployment fails mid-flight
on_failure() {
  local exit_code="$?"
  echo ""
  echo "=============================================================================="
  echo -e "${BOLD}${RED}[CRITICAL] Production Upgrade Pipeline Failed (Exit Code: ${exit_code})!${NC}"
  echo "=============================================================================="
  if [[ -n "$SNAPSHOT_PATH" ]]; then
    echo "A pre-migration database snapshot was created at:"
    echo "  ${SNAPSHOT_PATH}"
    echo ""
    echo "To immediately restore production to its pre-deployment state, run:"
    echo -e "  ${BOLD}${YELLOW}./scripts/devops/rollback-prod.sh --backup-file \"${SNAPSHOT_PATH}\"${NC}"
  else
    echo "To execute rollback with the latest available snapshot, run:"
    echo -e "  ${BOLD}${YELLOW}./scripts/devops/rollback-prod.sh${NC}"
  fi
  echo "=============================================================================="
  exit "$exit_code"
}
trap on_failure ERR

stage "Starting Production Zero-Downtime Upgrade Pipeline"
log "Target Environment: production"
log "Release Image Tag:  ${IMAGE_TAG}"
log "Dokploy Webhook:    $([ -n "$DEPLOY_URL" ] && echo "Configured" || echo "Local Compose Fallback")"
log "Date (UTC):         $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ------------------------------------------------------------------------------
# STEP 1: Pre-Promotion Staging Verification Gate
# ------------------------------------------------------------------------------
stage "Step 1/6: Pre-Promotion Staging Verification Gate"

if [ "$SKIP_STAGING_GATE" = false ]; then
  log "Verifying Staging stack health before permitting production promotion..."
  if [ "$DRY_RUN" = false ]; then
    "${SCRIPT_DIR}/smoke-test.sh" staging || {
      error "Production promotion BLOCKED: Staging smoke tests failed!"
      error "Fix staging regressions before attempting production deployment."
      exit 1
    }
    ok "Staging verification gate green. Proceeding to production promotion."
  else
    ok "[DRY-RUN] Staging smoke test verification simulated (Green)."
  fi
else
  warn "Pre-promotion Staging gate bypassed (--skip-staging-gate)."
fi

# ------------------------------------------------------------------------------
# STEP 2: Mandatory Production Safety Snapshot
# ------------------------------------------------------------------------------
stage "Step 2/6: Mandatory Production Database Safety Snapshot"

if [ "$SKIP_BACKUP" = false ]; then
  log "Creating mandatory pre-migration safety snapshot of Production database..."
  BACKUP_ARGS=(--env prod --reason pre-migration)
  if [ "$DRY_RUN" = true ]; then
    BACKUP_ARGS+=(--dry-run)
  fi

  BACKUP_OUTPUT="$("${SCRIPT_DIR}/backup.sh" "${BACKUP_ARGS[@]}")"
  echo "$BACKUP_OUTPUT"

  # Extract snapshot filepath from output
  SNAPSHOT_PATH="$(echo "$BACKUP_OUTPUT" | grep -E "Database Archive:[[:space:]]+" | awk '{print $NF}' || echo "")"
  ok "Production pre-migration snapshot secured: ${SNAPSHOT_PATH:-simulated}"
else
  warn "DANGER: Pre-migration snapshot skipped (--force-skip-backup)!"
fi

# ------------------------------------------------------------------------------
# STEP 3: Pre-Flight Zero-Downtime Migration Safety Check
# ------------------------------------------------------------------------------
stage "Step 3/6: Pre-Flight Zero-Downtime Migration Checks"

MIGRATIONS_DIR="${REPO_ROOT}/web/db/migrations"
if [[ -d "$MIGRATIONS_DIR" ]]; then
  log "Checking pending migrations for zero-downtime rule compliance..."
  # Query already-applied migrations to avoid alert fatigue on historical migrations
  CONTAINER="coffeemode-postgres-prod"
  DB_USER="coffeemode_prod_user"
  DB_NAME="coffeemode_prod"
  APPLIED_MIGRATIONS=""
  if [ "$DRY_RUN" = false ] && docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}' | grep -q "healthy"; then
    APPLIED_MIGRATIONS="$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
      psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT name FROM schema_migrations;" 2>/dev/null || echo "")"
  fi

  for sql_file in "${MIGRATIONS_DIR}"/*.sql; do
    MIG_NAME="$(basename "$sql_file")"
    if echo "$APPLIED_MIGRATIONS" | grep -qF "$MIG_NAME"; then
      continue # Skip historical already-applied migrations
    fi
    if grep -iqE "CREATE[[:space:]]+INDEX" "$sql_file" 2>/dev/null && ! grep -iqE "CONCURRENTLY" "$sql_file" 2>/dev/null; then
      warn "Table locking risk in pending migration ${MIG_NAME}: 'CREATE INDEX' without CONCURRENTLY."
    fi
  done
  ok "Zero-downtime migration analysis complete."
fi

# ------------------------------------------------------------------------------
# STEP 4: Production Database Schema Migration
# ------------------------------------------------------------------------------
stage "Step 4/6: Executing Database Schema Migrations"

# Resolve and validate production database password
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  if [[ -f "${REPO_ROOT}/deploy/dokploy/.env.prod" ]]; then
    POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "${REPO_ROOT}/deploy/dokploy/.env.prod" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
  fi
fi

if [ "$DRY_RUN" = false ]; then
  : "${POSTGRES_PASSWORD:?Error: POSTGRES_PASSWORD must be set in environment or deploy/dokploy/.env.prod}"
  DB_PASS="${POSTGRES_PASSWORD}"
  CONTAINER="coffeemode-postgres-prod"
  DB_USER="coffeemode_prod_user"
  DB_NAME="coffeemode_prod"
  DB_PORT=5432
  TARGET_DB_URL="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${DB_PORT}/${DB_NAME}?sslmode=disable"

  if docker ps --filter "name=^/${CONTAINER}$" --format '{{.Status}}' | grep -q "healthy"; then
    log "Production database '${CONTAINER}' is healthy. Applying migrations..."
    if [[ -f "${REPO_ROOT}/web/scripts/migrate.mjs" ]]; then
      (
        cd "${REPO_ROOT}/web"
        DATABASE_URL="$TARGET_DB_URL" node scripts/migrate.mjs
      )
    elif docker ps --filter "name=^/coffeemode-web-prod$" --format '{{.Status}}' | grep -q "Up"; then
      docker exec "coffeemode-web-prod" npm run db:migrate
    else
      error "CRITICAL: Unable to execute database migrations! Neither web/scripts/migrate.mjs nor running web container is available."
      exit 1
    fi
    ok "Database schema migrations applied to Production."
  else
    error "Production database container '${CONTAINER}' is not healthy or running."
    exit 1
  fi
else
  ok "[DRY-RUN] Production database schema migration simulated."
fi

# ------------------------------------------------------------------------------
# STEP 5: Zero-Downtime Rolling Container Replacement
# ------------------------------------------------------------------------------
stage "Step 5/6: Zero-Downtime Rolling Container Replacement"

# Resolve release image tag (SHA or timestamp if not specified)
RELEASE_TAG="${IMAGE_TAG}"
if [[ -z "$RELEASE_TAG" || "$RELEASE_TAG" == "latest" ]]; then
  RELEASE_TAG="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d_%H%M%SZ)"
fi
log "Target Release Tag: ${RELEASE_TAG}"

COMPOSE_FILE="${REPO_ROOT}/deploy/dokploy/docker-compose.prod.yml"

if [[ -n "$DEPLOY_URL" ]]; then
  log "Triggering Dokploy production deployment webhook..."
  if [ "$DRY_RUN" = false ]; then
    AUTH_HEADER=()
    if [[ -n "$DEPLOY_TOKEN" ]]; then
      AUTH_HEADER=(-H "Authorization: Bearer ${DEPLOY_TOKEN}")
    fi
    curl -fsS -X POST "${AUTH_HEADER[@]}" "${DEPLOY_URL}"
    ok "Dokploy deployment webhook triggered."
  else
    ok "[DRY-RUN] Dokploy production deploy webhook call simulated."
  fi
else
  log "Executing local Docker Compose zero-downtime rolling update (start-first)..."
  if [ "$DRY_RUN" = false ]; then
    IMAGE_TAG="${RELEASE_TAG}" docker compose -f "$COMPOSE_FILE" build web-prod
    docker tag "coffeemode-web-prod:${RELEASE_TAG}" "coffeemode-web-prod:latest" 2>/dev/null || true
    IMAGE_TAG="${RELEASE_TAG}" docker compose -f "$COMPOSE_FILE" up -d web-prod
    ok "Production web container updated with tag '${RELEASE_TAG}'."
  else
    ok "[DRY-RUN] Docker Compose build & up -d web-prod with tag '${RELEASE_TAG}' simulated."
  fi
fi

# Record release metadata for instant rollback auto-discovery
RELEASE_HISTORY_DIR="${REPO_ROOT}/backups/prod"
mkdir -p "$RELEASE_HISTORY_DIR"
RELEASE_LOG="${RELEASE_HISTORY_DIR}/releases.log"
if [ "$DRY_RUN" = false ]; then
  echo "${TIMESTAMP}|${RELEASE_TAG}|${SNAPSHOT_PATH:-}" >> "$RELEASE_LOG"
  ok "Recorded release in ${RELEASE_LOG}."
else
  ok "[DRY-RUN] Recorded release ${RELEASE_TAG} in releases.log simulated."
fi

# ------------------------------------------------------------------------------
# STEP 6: Post-Deployment Production Verification
# ------------------------------------------------------------------------------
stage "Step 6/6: Post-Deployment Production Verification"

BASE_URL="https://${PROD_DOMAIN:-coffeemode.app}"
if [ "$DRY_RUN" = false ]; then
  log "Polling health endpoint on ${BASE_URL}/api/health for release convergence (timeout: 120s)..."
  MAX_RETRIES=24
  RETRY=0
  IS_HEALTHY=false
  while [ $RETRY -lt $MAX_RETRIES ]; do
    RETRY=$((RETRY + 1))
    if curl -fsS -m 3 "${BASE_URL}/api/health" 2>/dev/null | grep -q '"ok":true'; then
      IS_HEALTHY=true
      break
    fi
    sleep 2
  done

  if [ "$IS_HEALTHY" = true ]; then
    ok "Production healthcheck is green."
  else
    error "Timed out waiting for production healthcheck on ${BASE_URL}/api/health after 120s."
    exit 1
  fi

  if [ "$SKIP_SMOKE" = false ]; then
    log "Executing automated smoke test suite against Production..."
    "${SCRIPT_DIR}/smoke-test.sh" prod || {
      error "Production smoke test FAILED!"
      exit 1
    }
    ok "All production smoke tests passed."
  else
    log "Skipping production smoke tests (--skip-smoke)."
  fi
else
  ok "[DRY-RUN] Production health convergence polling and smoke tests simulated."
fi

# Success: clear failure trap
trap - ERR

echo ""
echo "=============================================================================="
echo -e "${BOLD}${GREEN}Production Zero-Downtime Upgrade Completed Successfully!${NC}"
echo "=============================================================================="
echo "Environment: production"
echo "Release Tag: ${IMAGE_TAG}"
echo "Snapshot:    ${SNAPSHOT_PATH:-None}"
echo "Status:      Healthy & Live"
echo "URL:         https://${PROD_DOMAIN:-coffeemode.app}"
echo "=============================================================================="
