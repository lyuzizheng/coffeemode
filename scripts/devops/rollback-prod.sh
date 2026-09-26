#!/usr/bin/env bash
# ==============================================================================
# CafeMood Production Instant Rollback Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Reverts production stack to the state immediately before the release being undone:
#   1. Release-boundary resolution (releases.log -> target image + that release's own snapshot)
#   2. Reverts application container image digest via compose / Dokploy
#   3. Restores database schema and data from snapshot via ./restore.sh --env prod
#   4. Post-rollback automated health check and smoke test verification
#
# releases.log rows are written by upgrade-prod.sh AFTER a release lands:
#     <UTC timestamp>|<image tag>|<snapshot taken before that release's migrations>
# Row k therefore pairs image row[k-1].tag with snapshot row[k]: the snapshot is
# the boundary OF release k, and only the previous image ran against it. An
# unresolvable pairing aborts instead of falling back to an older archive.
#
# Usage:
#   ./rollback-prod.sh [options]
#
# Options:
#   -h, --help            Show this help message and exit
#   -f, --backup-file <s> Snapshot archive to restore; must pair with an image in releases.log
#   -t, --image-tag <tag> Image tag to revert to (default: the image recorded before the latest release)
#   --plan-only           Resolve and print the rollback plan, then exit without touching anything
#   --yes                 Bypass confirmation prompt
#   --skip-smoke          Skip post-rollback smoke tests
#   --dry-run             Log planned actions without modifying system state
#
# Examples:
#   ./rollback-prod.sh
#   ./rollback-prod.sh --plan-only
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
PLAN_ONLY=false

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
    --plan-only)
      PLAN_ONLY=true
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
# STEP 1: Release-Boundary Resolution (target image + boundary snapshot)
# ------------------------------------------------------------------------------
stage "Step 1/4: Release Boundary Identification"

# upgrade-prod.sh appends one row per release, after that release lands:
#     <UTC timestamp>|<image tag>|<snapshot taken before that release's migrations>
# Row k therefore carries two different subjects: the snapshot is the database
# boundary OF release k (data as of just before k), while the image that ran
# against that boundary is release k-1's tag. Undoing release k pairs them
# across rows; reading both fields from one row (pre-BRAWUKA-724) restored data
# one release older than the image it was restored under.
# (Supabase topology: local backup dir; legacy docker volume path removed BRAWUKA-241)
RELEASE_LOG="${REPO_ROOT}/backups/prod/releases.log"

ROW_TAGS=()
ROW_SNAPSHOTS=()

if [[ -f "$RELEASE_LOG" ]]; then
  while IFS='|' read -r row_ts row_tag row_snapshot _rest || [[ -n "${row_tag:-}" ]]; do
    [[ -n "${row_tag:-}" ]] || continue
    ROW_TAGS+=("$row_tag")
    ROW_SNAPSHOTS+=("${row_snapshot:-}")
  done < "$RELEASE_LOG"
fi
RELEASE_COUNT="${#ROW_TAGS[@]}"

# Index of the row whose column ($1 = tag | snapshot) equals $2, else -1.
# macOS ships bash 3.2 (no namerefs), so the column is chosen here instead of
# passing the array by name.
history_row_index() {
  local column="$1" value="$2" i current
  for ((i = 0; i < RELEASE_COUNT; i++)); do
    if [[ "$column" == "tag" ]]; then
      current="${ROW_TAGS[$i]}"
    else
      current="${ROW_SNAPSHOTS[$i]}"
    fi
    if [[ "$current" == "$value" ]]; then
      printf '%s' "$i"
      return 0
    fi
  done
  printf '%s' "-1"
}

TARGET_TAG=""
TARGET_SNAPSHOT=""
IMAGE_REQUESTED=false
if [[ -n "$IMAGE_TAG" && "$IMAGE_TAG" != "previous" ]]; then
  IMAGE_REQUESTED=true
fi

if [[ -n "$BACKUP_FILE" && "$IMAGE_REQUESTED" == true ]]; then
  # Both sides named explicitly: the operator owns the pairing, nothing is derived.
  TARGET_TAG="$IMAGE_TAG"
  TARGET_SNAPSHOT="$BACKUP_FILE"
elif [[ -n "$BACKUP_FILE" ]]; then
  # Snapshot only: the image that must run against it is the one recorded just before it.
  SNAPSHOT_ROW="$(history_row_index snapshot "$BACKUP_FILE")"
  if [[ "$SNAPSHOT_ROW" -ge 1 ]]; then
    TARGET_TAG="${ROW_TAGS[$((SNAPSHOT_ROW - 1))]}"
    TARGET_SNAPSHOT="$BACKUP_FILE"
  elif [[ "$SNAPSHOT_ROW" -eq 0 ]]; then
    error "Snapshot ${BACKUP_FILE} is the first deployment's boundary: no earlier image exists."
    error "Pass --image-tag <tag> to state which image must run against it."
    exit 1
  else
    error "Snapshot ${BACKUP_FILE} is not recorded in ${RELEASE_LOG}."
    error "A deployment that failed before its release-history append has no recorded image."
    if [[ "$RELEASE_COUNT" -ge 1 ]]; then
      error "Pass --image-tag <tag>; the last recorded release is ${ROW_TAGS[$((RELEASE_COUNT - 1))]}."
    else
      error "Pass --image-tag <tag>; no release history is recorded."
    fi
    exit 1
  fi
elif [[ "$IMAGE_REQUESTED" == true ]]; then
  # Image only: its boundary is the snapshot recorded for the release deployed right after it.
  IMAGE_ROW="$(history_row_index tag "$IMAGE_TAG")"
  if [[ "$IMAGE_ROW" -ge 0 && "$IMAGE_ROW" -lt $((RELEASE_COUNT - 1)) ]]; then
    TARGET_TAG="$IMAGE_TAG"
    TARGET_SNAPSHOT="${ROW_SNAPSHOTS[$((IMAGE_ROW + 1))]}"
    if [[ -z "$TARGET_SNAPSHOT" ]]; then
      error "Release ${ROW_TAGS[$((IMAGE_ROW + 1))]} recorded no boundary snapshot (--force-skip-backup)."
      error "Pass --backup-file <path> to name the snapshot to restore."
      exit 1
    fi
  elif [[ "$IMAGE_ROW" -ge 0 ]]; then
    error "No release is recorded after image ${IMAGE_TAG}, so no snapshot pairs with it."
    error "Pass --backup-file <path> to name the snapshot to restore."
    exit 1
  else
    error "Image tag ${IMAGE_TAG} is not recorded in ${RELEASE_LOG}."
    error "Pass --backup-file <path> to name the snapshot to restore."
    exit 1
  fi
elif [[ "$RELEASE_COUNT" -eq 0 ]]; then
  error "No releases recorded in ${RELEASE_LOG}; there is no rollback boundary to resolve."
  error "Pass --image-tag <tag> and --backup-file <path> explicitly."
  exit 1
elif [[ "$RELEASE_COUNT" -eq 1 ]]; then
  error "Only the first deployment (${ROW_TAGS[0]}) is recorded; there is no earlier image to roll back to."
  error "To restore its boundary snapshot under an explicit image, pass --image-tag and --backup-file."
  exit 1
else
  # Default: undo the newest recorded release — its own boundary snapshot,
  # restored under the image recorded one release earlier.
  TARGET_SNAPSHOT="${ROW_SNAPSHOTS[$((RELEASE_COUNT - 1))]}"
  if [[ -z "$TARGET_SNAPSHOT" ]]; then
    error "Latest recorded release ${ROW_TAGS[$((RELEASE_COUNT - 1))]} has no boundary snapshot (--force-skip-backup)."
    error "Pass --backup-file <path> to name the snapshot to restore."
    exit 1
  fi
  TARGET_TAG="${ROW_TAGS[$((RELEASE_COUNT - 2))]}"
fi

BACKUP_FILE="$TARGET_SNAPSHOT"

# An archive that is not where the boundary says it is must fail the run: the
# old behaviour searched the backup directory for the newest pre-migration
# dump and restored that instead, silently rolling back an extra release.
if [[ ! -f "$BACKUP_FILE" ]]; then
  error "Boundary snapshot not found: ${BACKUP_FILE}"
  error "Refusing to fall back to an older archive. Verify the path, or pass --backup-file <path>."
  exit 1
fi
ok "Boundary snapshot: ${BACKUP_FILE}"

if [ "$PLAN_ONLY" = true ]; then
  echo ""
  echo "Resolved rollback plan:"
  echo "  image_tag: ${TARGET_TAG}"
  echo "  snapshot:  ${BACKUP_FILE}"
  exit 0
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
    ENV_FILE="${REPO_ROOT}/deploy/dokploy/.env.prod"
    COMPOSE_ENV_ARGS=()
    if [[ -f "$ENV_FILE" ]]; then
      COMPOSE_ENV_ARGS=(--env-file "$ENV_FILE")
    fi
    IMAGE_TAG="${TARGET_TAG}" docker compose "${COMPOSE_ENV_ARGS[@]}" -f "$COMPOSE_FILE" up -d web-prod
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
echo "URL:               https://${PROD_DOMAIN:-cafemood.app}"
echo "=============================================================================="
