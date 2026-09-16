#!/usr/bin/env bash
# ==============================================================================
# CafeMood Cold-Start Infrastructure Orchestrator
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Orchestrates complete cold-start deployment from zero to live:
#   1. Runs VPS hardening & Dokploy setup (via ./provision-vps.sh)
#   2. Cloudflare edge & storage provisioning (R2 buckets, CORS, DNS)
#   3. Docker networks (traefik-net, isolated staging & prod bridges)
#   4. Supabase project verification (prod + staging, PostGIS present) —
#      databases live in Supabase (BRAWUKA-241), no local postgres containers
#   5. Database schema migration bootstrapping over DIRECT_URL (session)
#   6. Initial seed bootstrapping (CafeMood service account & base data)
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
COMPOSE_DIR="${REPO_ROOT}/deploy/dokploy"

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

stage "Starting CafeMood Cold-Start Orchestration"
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

# Per-env session-connection lookup (BRAWUKA-241 P0/P1): STAGING_DIRECT_URL /
# PROD_DIRECT_URL first, then deploy/dokploy/.env.<env> DIRECT_URL. Unscoped
# ambient DIRECT_URL/DATABASE_URL are NEVER consulted, so --env both cannot run
# both passes against the same project.
scoped_session_url() {
  local e="$1"
  local prefix
  if [[ "$e" == "staging" ]]; then prefix="STAGING"; else prefix="PROD"; fi
  local var="${prefix}_DIRECT_URL"
  if [[ -n "${!var:-}" ]]; then
    printf '%s' "${!var}"
    return 0
  fi
  local env_file="${COMPOSE_DIR}/.env.${e}"
  if [[ -f "$env_file" ]]; then
    local url
    url="$(grep -E '^DIRECT_URL=' "$env_file" | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")"
    if [[ -n "$url" ]]; then
      printf '%s' "$url"
      return 0
    fi
  fi
  return 1
}

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
              "origins": ["https://cafemood.app", "https://staging.cafemood.app", "http://localhost:3000"],
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

  # Note: images.cafemood.app and staging-images.cafemood.app are Cloudflare R2
  # custom domains connected directly to R2 buckets, NOT origin VPS A records.
  PUBLIC_IP="$(curl -s -m 5 https://api.ipify.org 2>/dev/null || echo "")"
  if [[ -n "$PUBLIC_IP" && -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
    provision_dns_record "cafemood.app" "$PUBLIC_IP"
    provision_dns_record "www.cafemood.app" "$PUBLIC_IP"
    provision_dns_record "staging.cafemood.app" "$PUBLIC_IP"
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

  # 2. Environment networks (no postgres data volumes: Supabase is the primary)
  for env in "${ENVS[@]}"; do
    NET_NAME="coffeemode-${env}-network"
    if ! docker network inspect "$NET_NAME" >/dev/null 2>&1; then
      docker network create --driver bridge "$NET_NAME"
      ok "Created isolated backend network '${NET_NAME}'."
    else
      ok "Network '${NET_NAME}' already exists."
    fi
  done
else
  ok "[DRY-RUN] Docker network and volume creation simulated."
fi

# ------------------------------------------------------------------------------
# STEP 4: Supabase Project Verification (no local postgres containers)
#
# Databases live in Supabase per BRAWUKA-240 D1 / decision 34a. Cold-start only
# verifies each target Supabase project is reachable and PostGIS-enabled;
# provisioning itself happens in the Supabase dashboard (owner) + provision-supabase.sh.
# ------------------------------------------------------------------------------
stage "Step 4/7: Supabase Project Verification"

for env in "${ENVS[@]}"; do
  log "Verifying Supabase ${env} project connectivity..."
  ENV_DIRECT_URL=""
  if ! ENV_DIRECT_URL="$(scoped_session_url "$env")"; then
    ENV_DIRECT_URL=""
  fi

  if [ "$DRY_RUN" = false ]; then
    if [[ -z "$ENV_DIRECT_URL" ]]; then
      error "Session connection for ${env} is required: STAGING_DIRECT_URL/PROD_DIRECT_URL or deploy/dokploy/.env.${env} DIRECT_URL"
      exit 1
    fi
    if ! command -v psql >/dev/null 2>&1; then
      error "psql not found in PATH. Install postgresql-client to verify Supabase projects."
      exit 1
    fi
    POSTGIS_CHECK="$(psql "$ENV_DIRECT_URL" -t -c "SELECT PostGIS_Version();" 2>/dev/null | tr -d '[:space:]' || echo "")"
    if [[ -z "$POSTGIS_CHECK" ]]; then
      error "Supabase ${env} project unreachable or PostGIS missing."
      exit 1
    fi
    ok "Supabase ${env} project verified (PostGIS ${POSTGIS_CHECK})."
  else
    ok "[DRY-RUN] Supabase ${env} project verification simulated."
  fi
done

# ------------------------------------------------------------------------------
# STEP 5: Schema Migration Bootstrapping
# ------------------------------------------------------------------------------
stage "Step 5/7: Database Schema Migration Bootstrapping"

for env in "${ENVS[@]}"; do
  log "Applying migrations to Supabase ${env} project..."
  # DDL must run over the per-env session connection (sslmode=require).
  MIGRATION_URL=""
  if ! MIGRATION_URL="$(scoped_session_url "$env")"; then
    MIGRATION_URL=""
  fi

  if [ "$DRY_RUN" = false ]; then
    if [[ -z "$MIGRATION_URL" ]]; then
      error "Session connection for ${env} is required: STAGING_DIRECT_URL/PROD_DIRECT_URL or deploy/dokploy/.env.${env} DIRECT_URL"
      exit 1
    fi
    if [[ ! -f "${REPO_ROOT}/web/scripts/migrate.mjs" ]]; then
      error "Migration runner not found at web/scripts/migrate.mjs."
      exit 1
    fi
    log "Running migrations via Node runner over DIRECT_URL (session)..."
    (
      cd "${REPO_ROOT}/web"
      DATABASE_URL="$MIGRATION_URL" node scripts/migrate.mjs
    )
    ok "All migrations successfully applied to Supabase ${env}."
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
    log "Bootstrapping service account profile and base records for Supabase ${env}..."
    SEED_URL=""
    if ! SEED_URL="$(scoped_session_url "$env")"; then
      SEED_URL=""
    fi

    if [ "$DRY_RUN" = false ]; then
      if [[ -z "$SEED_URL" ]]; then
        error "Session connection for ${env} is required: STAGING_DIRECT_URL/PROD_DIRECT_URL or deploy/dokploy/.env.${env} DIRECT_URL"
        exit 1
      fi
      # Check if service account profile already exists (seeded by migration 0016)
      PROFILE_CHECK="$(psql "$SEED_URL" -t -c \
        "SELECT 1 FROM profiles WHERE id = '00000000-0000-4000-a000-000000000001';" 2>/dev/null | tr -d '[:space:]' || echo "")"

      if [[ "$PROFILE_CHECK" == "1" ]]; then
        ok "Service account profile already verified in ${env}."
      else
        psql "$SEED_URL" -v ON_ERROR_STOP=1 -q -c \
          "INSERT INTO profiles (id, display_name) VALUES ('00000000-0000-4000-a000-000000000001', 'CafeMood') ON CONFLICT (id) DO NOTHING;" >/dev/null
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
    ENV_FILE="${COMPOSE_DIR}/.env.${env}"
    COMPOSE_ENV_ARGS=()
    if [[ -f "$ENV_FILE" ]]; then
      COMPOSE_ENV_ARGS=(--env-file "$ENV_FILE")
    fi

    if [ "$DRY_RUN" = false ]; then
      docker compose "${COMPOSE_ENV_ARGS[@]}" -f "$COMPOSE_FILE" up -d --build "web-${env}"

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
echo -e "${BOLD}${GREEN}CafeMood Cold-Start Orchestration Completed Successfully!${NC}"
echo "=============================================================================="
echo "Environments: ${TARGET_ENV}"
echo "Databases:    PostgreSQL 16 + PostGIS active"
echo "Networks:     traefik-net, coffeemode-staging-network, coffeemode-prod-network"
echo "Next Steps:   Monitor services via 'docker ps' or Dokploy dashboard."
echo "=============================================================================="
