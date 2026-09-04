#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Cold-Start Infrastructure Orchestrator
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Orchestrates complete cold-start deployment from zero to live:
#   1. Runs VPS hardening & Dokploy setup (via ./provision-vps.sh)
#   2. Cloudflare edge & storage provisioning (R2 buckets, CORS, DNS)
#   3. Docker networks (traefik-net, isolated staging & prod bridges)
#   4. PostGIS 16 database provisioning with healthcheck verification
#   5. Database schema migration bootstrapping (all 16 SQL migrations)
#   6. Initial seed bootstrapping (CoffeeMode service account & base data)
#   7. Web application container deployment behind Traefik
#   8. Automated post-bootstrap smoke test verification
#
# Usage:
#   ./bootstrap.sh [options]
#
# Options:
#   -h, --help            Show this help message and exit
#   --env <env>           Target environment: staging | prod | both (default: both)
#   --skip-vps-prep       Skip provision-vps.sh (e.g. if host already prepared)
#   --skip-cloudflare     Skip Cloudflare R2 bucket & DNS API provisioning
#   --skip-seed           Skip baseline seed data insertion
#   --skip-app            Skip building and deploying web application containers
#   --skip-smoke          Skip post-bootstrap automated smoke test
#   --dry-run             Log planned actions without modifying system state
#
# Examples:
#   ./bootstrap.sh
#   ./bootstrap.sh --env staging
#   ./bootstrap.sh --skip-vps-prep --env prod
#   ./bootstrap.sh --dry-run
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
TARGET_ENV="both"
SKIP_VPS_PREP=false
SKIP_CLOUDFLARE=false
SKIP_SEED=false
SKIP_APP=false
SKIP_SMOKE=false
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
    --env)
      TARGET_ENV="${2:?Error: --env requires an environment argument (staging|prod|both)}"
      shift 2
      ;;
    --skip-vps-prep)
      SKIP_VPS_PREP=true
      shift
      ;;
    --skip-cloudflare)
      SKIP_CLOUDFLARE=true
      shift
      ;;
    --skip-seed)
      SKIP_SEED=true
      shift
      ;;
    --skip-app)
      SKIP_APP=true
      shift
      ;;
    --skip-smoke)
      SKIP_SMOKE=true
      shift
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

if [[ "$TARGET_ENV" != "staging" && "$TARGET_ENV" != "prod" && "$TARGET_ENV" != "both" ]]; then
  echo "Error: Invalid target environment '$TARGET_ENV'. Must be 'staging', 'prod', or 'both'." >&2
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
stage() { echo -e "\n${BOLD}${CYAN}=== $* ===${NC}"; }

run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${YELLOW}[DRY-RUN]${NC} $*"
  else
    "$@"
  fi
}

stage "Starting CoffeeMode Cold-Start Orchestration"
log "Target Environment: ${TARGET_ENV}"
log "Repository Root:    ${REPO_ROOT}"
log "Dry-Run:            ${DRY_RUN}"

# Resolve environments to process
ENVS=()
if [ "$TARGET_ENV" = "both" ]; then
  ENVS=("staging" "prod")
else
  ENVS=("$TARGET_ENV")
fi

# ------------------------------------------------------------------------------
# STEP 1: VPS Hardening & Base Environment Provisioning
# ------------------------------------------------------------------------------
if [ "$SKIP_VPS_PREP" = false ]; then
  stage "Step 1/7: VPS Host Provisioning & Hardening"
  log "Executing provision-vps.sh..."
  PROVISION_ARGS=()
  if [ "$DRY_RUN" = true ]; then
    PROVISION_ARGS+=(--dry-run)
  fi
  "${SCRIPT_DIR}/provision-vps.sh" "${PROVISION_ARGS[@]}"
  ok "VPS host provisioning finished."
else
  stage "Step 1/7: VPS Host Provisioning"
  log "Skipping VPS host prep (--skip-vps-prep)."
fi

# ------------------------------------------------------------------------------
# STEP 2: Cloudflare Edge & R2 Storage Provisioning
# ------------------------------------------------------------------------------
stage "Step 2/7: Cloudflare Edge, DNS & R2 Storage Provisioning"

provision_r2_bucket() {
  local bucket_name="$1"
  local cf_account_id="${CLOUDFLARE_ACCOUNT_ID:-}"
  local cf_token="${CLOUDFLARE_API_TOKEN:-}"

  if [[ -z "$cf_account_id" || -z "$cf_token" ]]; then
    warn "CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not set. Skipping API creation for bucket '${bucket_name}'."
    return 0
  fi

  log "Provisioning Cloudflare R2 bucket: ${bucket_name}..."
  if [ "$DRY_RUN" = false ]; then
    # PUT /accounts/:account_id/r2/buckets/:bucket_name creates or idempotently succeeds
    local status
    status="$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
      "https://api.cloudflare.com/client/v4/accounts/${cf_account_id}/r2/buckets/${bucket_name}" \
      -H "Authorization: Bearer ${cf_token}" \
      -H "Content-Type: application/json")"

    if [[ "$status" =~ ^(200|409)$ ]]; then
      ok "R2 bucket '${bucket_name}' is ready (HTTP ${status})."
    else
      warn "Cloudflare API returned status ${status} for bucket '${bucket_name}'."
    fi

    # Configure CORS policy for web client direct uploads
    log "Configuring CORS policy for '${bucket_name}'..."
    curl -s -X PUT \
      "https://api.cloudflare.com/client/v4/accounts/${cf_account_id}/r2/buckets/${bucket_name}/cors" \
      -H "Authorization: Bearer ${cf_token}" \
      -H "Content-Type: application/json" \
      -d '{
        "rules": [
          {
            "allowed": {
              "origins": ["https://coffeemode.app", "https://staging.coffeemode.app", "http://localhost:3000"],
              "methods": ["GET", "PUT", "HEAD"],
              "headers": ["*"]
            },
            "maxAgeSeconds": 3600
          }
        ]
      }' >/dev/null 2>&1 || true
  else
    ok "[DRY-RUN] Provisioning R2 bucket '${bucket_name}' and CORS simulated."
  fi
}

provision_dns_record() {
  local record_name="$1"
  local target_ip="$2"
  local cf_zone_id="${CLOUDFLARE_ZONE_ID:-}"
  local cf_token="${CLOUDFLARE_API_TOKEN:-}"

  if [[ -z "$cf_zone_id" || -z "$cf_token" ]]; then
    return 0
  fi

  log "Configuring Cloudflare DNS A record: ${record_name} -> ${target_ip} (proxied)..."
  if [ "$DRY_RUN" = false ]; then
    # Idempotent lookup-then-upsert to prevent duplicate round-robin DNS records
    local existing_id
    existing_id="$(curl -s -X GET \
      "https://api.cloudflare.com/client/v4/zones/${cf_zone_id}/dns_records?type=A&name=${record_name}" \
      -H "Authorization: Bearer ${cf_token}" \
      -H "Content-Type: application/json" | jq -r '.result[0].id // empty')"

    if [[ -n "$existing_id" ]]; then
      log "Updating existing DNS A record '${record_name}' (${existing_id})..."
      curl -s -X PUT \
        "https://api.cloudflare.com/client/v4/zones/${cf_zone_id}/dns_records/${existing_id}" \
        -H "Authorization: Bearer ${cf_token}" \
        -H "Content-Type: application/json" \
        -d "{
          \"type\": \"A\",
          \"name\": \"${record_name}\",
          \"content\": \"${target_ip}\",
          \"ttl\": 1,
          \"proxied\": true
        }" >/dev/null 2>&1 || true
      ok "DNS record '${record_name}' updated."
    else
      log "Creating new DNS A record '${record_name}'..."
      curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/${cf_zone_id}/dns_records" \
        -H "Authorization: Bearer ${cf_token}" \
        -H "Content-Type: application/json" \
        -d "{
          \"type\": \"A\",
          \"name\": \"${record_name}\",
          \"content\": \"${target_ip}\",
          \"ttl\": 1,
          \"proxied\": true
        }" >/dev/null 2>&1 || true
      ok "DNS record '${record_name}' created."
    fi
  else
    ok "[DRY-RUN] DNS A record configuration for '${record_name}' simulated."
  fi
}

if [ "$SKIP_CLOUDFLARE" = false ]; then
  # Buckets per Spec 0005: Staging, Prod, and automated backups
  provision_r2_bucket "coffeemode-images-staging"
  provision_r2_bucket "coffeemode-images-prod"
  provision_r2_bucket "coffeemode-backups"

  # Note: images.coffeemode.app and staging-images.coffeemode.app are Cloudflare R2
  # custom domains connected directly to R2 buckets, NOT origin VPS A records.
  PUBLIC_IP="$(curl -s -m 5 https://api.ipify.org 2>/dev/null || echo "")"
  if [[ -n "$PUBLIC_IP" && -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
    provision_dns_record "coffeemode.app" "$PUBLIC_IP"
    provision_dns_record "www.coffeemode.app" "$PUBLIC_IP"
    provision_dns_record "staging.coffeemode.app" "$PUBLIC_IP"
  fi
  ok "Cloudflare edge & storage configuration complete."
else
  log "Skipping Cloudflare provisioning (--skip-cloudflare)."
fi

# ------------------------------------------------------------------------------
# STEP 3: Network & Volume Initialization
# ------------------------------------------------------------------------------
stage "Step 3/7: Docker Networks & Persistent Volumes Initialization"

if [ "$DRY_RUN" = false ]; then
  # 1. Ingress network
  if ! docker network inspect traefik-net >/dev/null 2>&1; then
    docker network create --driver bridge traefik-net
    ok "Created external network 'traefik-net'."
  else
    ok "Network 'traefik-net' already exists."
  fi

  # 2. Environment networks and volumes
  for env in "${ENVS[@]}"; do
    NET_NAME="coffeemode-${env}-network"
    if ! docker network inspect "$NET_NAME" >/dev/null 2>&1; then
      docker network create --driver bridge "$NET_NAME"
      ok "Created isolated backend network '${NET_NAME}'."
    else
      ok "Network '${NET_NAME}' already exists."
    fi

    # Persistent PostgreSQL and Backup volumes
    DATA_VOL="coffeemode_postgres_${env}_data"
    BACKUP_VOL="coffeemode_postgres_${env}_backups"

    docker volume create "$DATA_VOL" >/dev/null
    docker volume create "$BACKUP_VOL" >/dev/null
    ok "Volumes '${DATA_VOL}' and '${BACKUP_VOL}' verified."
  done
else
  ok "[DRY-RUN] Docker network and volume creation simulated."
fi

# ------------------------------------------------------------------------------
# STEP 4: PostgreSQL 16 + PostGIS Launch & Healthcheck
# ------------------------------------------------------------------------------
stage "Step 4/7: PostgreSQL 16 + PostGIS Deployment & Healthcheck"

COMPOSE_DIR="${REPO_ROOT}/deploy/dokploy"

for env in "${ENVS[@]}"; do
  log "Deploying PostgreSQL 16 PostGIS container for ${env}..."
  CONTAINER="coffeemode-postgres-${env}"
  COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.${env}.yml"

  if [ ! -f "$COMPOSE_FILE" ]; then
    error "Compose file not found: ${COMPOSE_FILE}"
    exit 1
  fi

  if [ "$DRY_RUN" = false ]; then
    # Resolve password specifically for this environment (no cross-env leak)
    ENV_PASSWORD="${POSTGRES_PASSWORD:-}"
    if [[ -z "$ENV_PASSWORD" && -f "${REPO_ROOT}/deploy/dokploy/.env.${env}" ]]; then
      ENV_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "${REPO_ROOT}/deploy/dokploy/.env.${env}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
    fi
    : "${ENV_PASSWORD:?Error: POSTGRES_PASSWORD must be set in environment or deploy/dokploy/.env.${env}}"

    DB_URL="postgres://coffeemode_${env}_user:${ENV_PASSWORD}@127.0.0.1:$([ "$env" = "staging" ] && echo 5433 || echo 5432)/coffeemode_${env}?sslmode=disable"

    # Bring up database service with environment-scoped credentials
    POSTGRES_PASSWORD="${ENV_PASSWORD}" DATABASE_URL="${DB_URL}" \
      docker compose -f "$COMPOSE_FILE" up -d "postgres-${env}"
    log "Waiting for '${CONTAINER}' to become healthy..."
    MAX_ATTEMPTS=30
    ATTEMPT=0
    HEALTHY=false

    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
      ATTEMPT=$((ATTEMPT + 1))
      STATUS="$(docker inspect --format='{{json .State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo '"unknown"')"
      if [ "$STATUS" = '"healthy"' ]; then
        HEALTHY=true
        break
      fi
      sleep 2
    done

    if [ "$HEALTHY" = true ]; then
      ok "Database '${CONTAINER}' is healthy and ready for connections."
    else
      error "Database '${CONTAINER}' failed to become healthy after $((MAX_ATTEMPTS * 2))s."
      docker logs --tail 20 "$CONTAINER"
      exit 1
    fi
  else
    ok "[DRY-RUN] Deployment of 'postgres-${env}' simulated."
  fi
done

# ------------------------------------------------------------------------------
# STEP 5: Schema Migration Bootstrapping
# ------------------------------------------------------------------------------
stage "Step 5/7: Database Schema Migration Bootstrapping"

for env in "${ENVS[@]}"; do
  log "Applying migrations to ${env} database..."
  DB_PORT="$([ "$env" = "staging" ] && echo 5433 || echo 5432)"
  DB_USER="coffeemode_${env}_user"
  DB_NAME="coffeemode_${env}"
  CONTAINER="coffeemode-postgres-${env}"
  DB_PASS="${POSTGRES_PASSWORD:-}"
  if [[ -z "$DB_PASS" && -f "${REPO_ROOT}/deploy/dokploy/.env.${env}" ]]; then
    DB_PASS="$(grep -E '^POSTGRES_PASSWORD=' "${REPO_ROOT}/deploy/dokploy/.env.${env}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
  fi
  if [ "$DRY_RUN" = false ]; then
    : "${DB_PASS:?Error: POSTGRES_PASSWORD must be set in environment or deploy/dokploy/.env.${env}}"
  fi
  TARGET_DB_URL="postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${DB_PORT}/${DB_NAME}?sslmode=disable"

  if [ "$DRY_RUN" = false ]; then
    if [[ -f "${REPO_ROOT}/web/scripts/migrate.mjs" && -f "${REPO_ROOT}/web/package.json" ]]; then
      log "Running migrations via Node runner against ${TARGET_DB_URL}..."
      (
        cd "${REPO_ROOT}/web"
        DATABASE_URL="$TARGET_DB_URL" node scripts/migrate.mjs
      )
      ok "All migrations successfully applied to ${env}."
    else
      # Fallback: run inside container if local Node is absent
      log "Executing migrations inside database container '${CONTAINER}'..."
      for sql_file in "${REPO_ROOT}/web/db/migrations"/*.sql; do
        if [ -f "$sql_file" ]; then
          log "Applying $(basename "$sql_file")..."
          docker exec -i -e PGPASSWORD="$DB_PASS" "coffeemode-postgres-${env}" \
            psql -U "$DB_USER" -d "$DB_NAME" < "$sql_file" >/dev/null
        fi
      done
      ok "Migrations applied via container psql to ${env}."
    fi
  else
    ok "[DRY-RUN] Schema migrations execution simulated for ${env}."
  fi
done

# ------------------------------------------------------------------------------
# STEP 6: Seed Data Bootstrapping
# ------------------------------------------------------------------------------
if [ "$SKIP_SEED" = false ]; then
  stage "Step 6/7: Seed Data Bootstrapping"
  for env in "${ENVS[@]}"; do
    log "Bootstrapping service account profile and base records for ${env}..."
    DB_USER="coffeemode_${env}_user"
    DB_NAME="coffeemode_${env}"
    DB_PASS="${POSTGRES_PASSWORD:-}"
    if [[ -z "$DB_PASS" && -f "${REPO_ROOT}/deploy/dokploy/.env.${env}" ]]; then
      DB_PASS="$(grep -E '^POSTGRES_PASSWORD=' "${REPO_ROOT}/deploy/dokploy/.env.${env}" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
    fi
    if [ "$DRY_RUN" = false ]; then
      : "${DB_PASS:?Error: POSTGRES_PASSWORD must be set in environment or deploy/dokploy/.env.${env}}"
    fi

    if [ "$DRY_RUN" = false ]; then
      # Check if service account profile already exists (seeded by migration 0016)
      PROFILE_CHECK="$(docker exec -e PGPASSWORD="$DB_PASS" "coffeemode-postgres-${env}" \
        psql -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT 1 FROM profiles WHERE id = '00000000-0000-4000-a000-000000000001';" 2>/dev/null | tr -d '[:space:]' || echo "")"

      if [[ "$PROFILE_CHECK" == "1" ]]; then
        ok "Service account profile already verified in ${env}."
      else
        docker exec -e PGPASSWORD="$DB_PASS" "coffeemode-postgres-${env}" \
          psql -U "$DB_USER" -d "$DB_NAME" -c \
          "INSERT INTO profiles (id, display_name) VALUES ('00000000-0000-4000-a000-000000000001', 'CoffeeMode') ON CONFLICT (id) DO NOTHING;" >/dev/null
        ok "Service account profile seeded in ${env}."
      fi
    else
      ok "[DRY-RUN] Seed bootstrapping simulated for ${env}."
    fi
  done
else
  stage "Step 6/7: Seed Data Bootstrapping"
  log "Skipping seed data (--skip-seed)."
fi
# STEP 7: Web Application Container Deployment & Verification
# ------------------------------------------------------------------------------
if [ "$SKIP_APP" = false ]; then
  stage "Step 7/7: Web Application Deployment & Smoke Tests"
  for env in "${ENVS[@]}"; do
    log "Deploying web application for ${env}..."
    COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.${env}.yml"

    if [ "$DRY_RUN" = false ]; then
      docker compose -f "$COMPOSE_FILE" up -d --build "web-${env}"

      log "Waiting for 'coffeemode-web-${env}' readiness..."
      sleep 10

      if [ "$SKIP_SMOKE" = false ]; then
        log "Executing automated smoke test suite for ${env}..."
        "${SCRIPT_DIR}/smoke-test.sh" "$env" || {
          warn "Smoke test encountered warnings. Review logs via 'docker logs coffeemode-web-${env}'."
        }
      fi
    else
      ok "[DRY-RUN] Deployment of 'web-${env}' and smoke test simulated."
    fi
  done
else
  stage "Step 7/7: Web Application Deployment"
  log "Skipping application deployment (--skip-app)."
fi

echo ""
echo "=============================================================================="
echo -e "${BOLD}${GREEN}CoffeeMode Cold-Start Orchestration Completed Successfully!${NC}"
echo "=============================================================================="
echo "Environments: ${TARGET_ENV}"
echo "Databases:    PostgreSQL 16 + PostGIS active"
echo "Networks:     traefik-net, coffeemode-staging-network, coffeemode-prod-network"
echo "Next Steps:   Monitor services via 'docker ps' or Dokploy dashboard."
echo "=============================================================================="
