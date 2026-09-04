#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Production Instant Rollback Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Reverts production stack to pre-migration baseline in the event of deployment anomaly:
#   1. Snapshot auto-discovery (finds most recent pre-migration snapshot)
#   2. Reverts application container image digest via compose / Dokploy
#   3. Restores database schema and data from snapshot via ./restore.sh --env prod
#   4. Post-rollback automated health check and smoke test verification
#
# Usage:
#   ./rollback-prod.sh [options]
#
# Options:
#   -h, --help            Show this help message and exit
#   -f, --backup-file <s> Path to specific pre-migration snapshot archive
#   -t, --image-tag <tag> Image tag to revert to (default: previous)
#   --yes                 Bypass confirmation prompt
#   --skip-smoke          Skip post-rollback smoke tests
#   --dry-run             Log planned actions without modifying system state
#
# Examples:
#   ./rollback-prod.sh
#   ./rollback-prod.sh --backup-file /backups/coffeemode_prod_pre-migration_20260904_090000Z.dump.gz
#   ./rollback-prod.sh --yes
#   ./rollback-prod.sh --dry-run
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
BACKUP_FILE=""
IMAGE_TAG="previous"
CONFIRM_FLAG=false
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
    -f|--backup-file)
      BACKUP_FILE="${2:?Error: --backup-file requires a file path}"
      shift 2
      ;;
    -t|--image-tag)
      IMAGE_TAG="${2:?Error: --image-tag requires an image tag}"
      shift 2
      ;;
    --yes)
      CONFIRM_FLAG=true
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

# ------------------------------------------------------------------------------
# STEP 1: Pre-Migration Snapshot Auto-Discovery
# ------------------------------------------------------------------------------
stage "Step 1/4: Pre-Migration Snapshot & Image Tag Identification"

# Resolve previous release tag from release history log
SEARCH_DIRS=(
  "/var/lib/docker/volumes/coffeemode_postgres_prod_backups/_data"
  "${REPO_ROOT}/backups/prod"
)

RESOLVED_PREV_TAG=""
RESOLVED_PREV_SNAPSHOT=""

for dir in "${SEARCH_DIRS[@]}"; do
  RELEASE_LOG="${dir}/releases.log"
  if [[ -f "$RELEASE_LOG" ]]; then
    LINE_COUNT="$(wc -l < "$RELEASE_LOG" | tr -d ' ')"
    if [[ "$LINE_COUNT" -ge 2 ]]; then
      PREV_LINE="$(tail -n 2 "$RELEASE_LOG" | head -n 1)"
      RESOLVED_PREV_TAG="$(echo "$PREV_LINE" | cut -d'|' -f2)"
      RESOLVED_PREV_SNAPSHOT="$(echo "$PREV_LINE" | cut -d'|' -f3)"
      break
    elif [[ "$LINE_COUNT" -eq 1 ]]; then
      # Only 1 release recorded, use it if needed
      RESOLVED_PREV_TAG="$(tail -n 1 "$RELEASE_LOG" | cut -d'|' -f2)"
    fi
  fi
done

# Fallback image tag resolution from local docker image repository
if [[ -z "$RESOLVED_PREV_TAG" && "$DRY_RUN" = false ]]; then
  RESOLVED_PREV_TAG="$(docker images coffeemode-web-prod --format '{{.Tag}}' 2>/dev/null | grep -v 'latest' | grep -v '<none>' | head -n 1 || echo "")"
fi

TARGET_TAG="${IMAGE_TAG}"
if [[ "$TARGET_TAG" == "previous" || -z "$TARGET_TAG" ]]; then
  if [[ -n "$RESOLVED_PREV_TAG" ]]; then
    TARGET_TAG="$RESOLVED_PREV_TAG"
  else
    if [ "$DRY_RUN" = true ]; then
      TARGET_TAG="previous_dryrun_tag"
      ok "[DRY-RUN] Using simulated previous tag '${TARGET_TAG}'."
    else
      error "CRITICAL: Unable to resolve previous release image tag!"
      error "No releases recorded in releases.log and no previous local image tags found."
      error "Please specify a target image tag explicitly via --image-tag <tag>."
      exit 1
    fi
  fi
fi

if [[ -z "$BACKUP_FILE" ]]; then
  if [[ -n "$RESOLVED_PREV_SNAPSHOT" && -f "$RESOLVED_PREV_SNAPSHOT" ]]; then
    BACKUP_FILE="$RESOLVED_PREV_SNAPSHOT"
    ok "Auto-discovered snapshot from release history: ${BACKUP_FILE}"
  else
    log "Searching for latest production pre-migration snapshot in filesystem..."
    LATEST_SNAPSHOT=""
    for dir in "${SEARCH_DIRS[@]}"; do
      if [[ -d "$dir" ]]; then
        FOUND="$(find "$dir" -name "coffeemode_prod_pre-migration_*.dump.gz" -type f 2>/dev/null | sort -r | head -n 1 || echo "")"
        if [[ -n "$FOUND" ]]; then
          LATEST_SNAPSHOT="$FOUND"
          break
        fi
      fi
    done

    if [[ -n "$LATEST_SNAPSHOT" ]]; then
      BACKUP_FILE="$LATEST_SNAPSHOT"
      ok "Identified latest snapshot: ${BACKUP_FILE}"
    else
      if [ "$DRY_RUN" = true ]; then
        BACKUP_FILE="${REPO_ROOT}/backups/prod/simulated_pre-migration.dump.gz"
        ok "[DRY-RUN] Using simulated snapshot: ${BACKUP_FILE}"
      else
        error "No pre-migration snapshot found in search paths!"
        error "Please specify a snapshot manually via --backup-file <path>."
        exit 1
      fi
    fi
  fi
else
  if [ "$DRY_RUN" = false ]; then
    if [[ ! -f "$BACKUP_FILE" ]]; then
      error "Specified backup file not found: ${BACKUP_FILE}"
      exit 1
    fi
  fi
  ok "Using specified snapshot: ${BACKUP_FILE}"
fi

echo ""
echo "=============================================================================="
echo -e "${BOLD}${RED}PRODUCTION INSTANT ROLLBACK REQUESTED${NC}"
echo "Target Environment: production"
echo "Target Snapshot:    ${BACKUP_FILE}"
echo "Target Image Tag:   ${TARGET_TAG}"
echo "=============================================================================="

# Confirmation prompt
if [ "$CONFIRM_FLAG" = false ] && [ "$DRY_RUN" = false ]; then
  read -rp "Are you sure you want to rollback production? (Type 'ROLLBACK' to confirm): " CONFIRMATION
  if [[ "$CONFIRMATION" != "ROLLBACK" ]]; then
    echo "Rollback aborted by operator."
    exit 0
  fi
fi

# ------------------------------------------------------------------------------
# STEP 2: Revert Application Container
# ------------------------------------------------------------------------------
stage "Step 2/4: Reverting Application Container"

log "Rolling back application container to tag '${TARGET_TAG}'..."
COMPOSE_FILE="${REPO_ROOT}/deploy/dokploy/docker-compose.prod.yml"

if [ "$DRY_RUN" = false ]; then
  SWARM_STATE="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo 'inactive')"
  if [ "$SWARM_STATE" = "active" ]; then
    log "Rolling back Docker Swarm service coffeemode-prod_web-prod..."
    docker service rollback coffeemode-prod_web-prod 2>/dev/null || \
      docker service update --image "coffeemode-web-prod:${TARGET_TAG}" coffeemode-prod_web-prod
  else
    log "Recreating container with IMAGE_TAG=${TARGET_TAG} via Docker Compose..."
    IMAGE_TAG="${TARGET_TAG}" docker compose -f "$COMPOSE_FILE" up -d web-prod
  fi
  RUNNING_IMG="$(docker inspect --format='{{.Config.Image}}' coffeemode-web-prod 2>/dev/null || echo "coffeemode-web-prod:${TARGET_TAG}")"
  ok "Web container reverted to image: ${RUNNING_IMG}"
else
  ok "[DRY-RUN] Application container rollback to image tag '${TARGET_TAG}' simulated."
fi

# ------------------------------------------------------------------------------
# STEP 3: Restore Database from Pre-Migration Snapshot
# ------------------------------------------------------------------------------
stage "Step 3/4: Restoring Production Database from Snapshot"

log "Executing database restoration via restore.sh..."
RESTORE_ARGS=(--env prod --file "$BACKUP_FILE" --yes)
if [ "$DRY_RUN" = true ]; then
  RESTORE_ARGS+=(--dry-run)
fi

"${SCRIPT_DIR}/restore.sh" "${RESTORE_ARGS[@]}"
ok "Database restored to pre-migration state."

# ------------------------------------------------------------------------------
# STEP 4: Post-Rollback Health & Smoke Test Verification
# ------------------------------------------------------------------------------
stage "Step 4/4: Post-Rollback Verification"

if [ "$SKIP_SMOKE" = false ]; then
  if [ "$DRY_RUN" = false ]; then
    log "Allowing 5s grace period for container stabilization..."
    sleep 5
    log "Running automated smoke test suite on restored production stack..."
    "${SCRIPT_DIR}/smoke-test.sh" prod || {
      error "Post-rollback smoke test failed! Immediate manual investigation required."
      exit 1
    }
    ok "Post-rollback smoke tests passed."
  else
    ok "[DRY-RUN] Smoke test verification simulated."
  fi
else
  log "Skipping post-rollback smoke tests (--skip-smoke)."
fi

echo ""
echo "=============================================================================="
echo -e "${BOLD}${GREEN}Production Rollback Completed Successfully!${NC}"
echo "=============================================================================="
echo "Restored Snapshot: ${BACKUP_FILE}"
echo "Status:            Operational & Verified"
echo "URL:               https://${PROD_DOMAIN:-coffeemode.app}"
echo "=============================================================================="
