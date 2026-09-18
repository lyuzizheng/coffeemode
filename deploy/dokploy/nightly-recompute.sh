#!/usr/bin/env bash
# ==============================================================================
# CafeMood Nightly Work Stats Recompute & Helpful Ranking Snapshot
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Autopilot:    docs/specs/0004-product-decisions-and-backlog.md, BRAWUKA-475/476
# ==============================================================================
# Executes idempotent drift correction (work_stats full recompute) and daily
# decayed Helpful ranking snapshot. Runs on the Dokploy VPS (via Dokploy scheduled
# job or VPS crontab at 02:00 UTC) reusing the container's DATABASE_URL.
#
# Primary container runner: web/scripts/nightly-recompute.mjs
# This script is the host wrapper (cron / manual CLI) that delegates to the
# container's node runner via `docker exec`.
#
# If execution fails, exits non-zero, outputs structured JSON error lines, and
# triggers the Multica autopilot webhook (MULTICA_AUTOPILOT_WEBHOOK_URL) if set.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# ------------------------------------------------------------------------------
# Defaults & CLI Argument Parsing
# ------------------------------------------------------------------------------
TARGET_ENV="prod"
CONTAINER_OVERRIDE=""
DRY_RUN=false
VERBOSE=false

show_help() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  -e, --env <env>          Target environment: prod (default) or staging
  -c, --container <id>     Explicit container name or ID override
  -d, --dry-run            Simulate without executing recompute/snapshot
  -v, --verbose            Enable verbose output
  -h, --help               Show this help message and exit

Environment Variables:
  MULTICA_AUTOPILOT_WEBHOOK_URL  Webhook URL for failure alerting (BRAWUKA-476)
  CONTAINER_NAME                 Alternative container name override
  DATABASE_URL                   Database connection string (when running internally)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--env)
      TARGET_ENV="${2:-}"
      shift 2
      ;;
    -c|--container)
      CONTAINER_OVERRIDE="${2:-}"
      shift 2
      ;;
    -d|--dry-run)
      DRY_RUN=true
      shift
      ;;
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

# ------------------------------------------------------------------------------
# Failure Hook & Notification Helper (Host fallback)
# ------------------------------------------------------------------------------
send_failure_alert() {
  local error_msg="$1"
  local run_pointer="${2:-dokploy:host:nightly-recompute}"
  local webhook_url="${MULTICA_AUTOPILOT_WEBHOOK_URL:-}"

  # Output structured error line (JSON) for monitoring sinks using node/jq for robust escaping
  local json_log
  if command -v node >/dev/null 2>&1; then
    json_log=$(node -e '
      const [msg, run, ts] = process.argv.slice(1);
      console.log(JSON.stringify({job: "nightly-recompute", status: "failed", error: msg, run, timestamp: ts}));
    ' "$error_msg" "$run_pointer" "$TIMESTAMP")
  elif command -v jq >/dev/null 2>&1; then
    json_log=$(jq -nc --arg error "$error_msg" --arg run "$run_pointer" --arg timestamp "$TIMESTAMP" \
      '{job: "nightly-recompute", status: "failed", error: $error, run: $run, timestamp: $timestamp}')
  else
    local escaped_msg
    escaped_msg=$(printf '%s' "$error_msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r\t' '   ')
    json_log="{\"job\":\"nightly-recompute\",\"status\":\"failed\",\"error\":\"$escaped_msg\",\"run\":\"$run_pointer\",\"timestamp\":\"$TIMESTAMP\"}"
  fi
  echo "$json_log" >&2

  if [[ -n "$webhook_url" ]]; then
    echo "[INFO] Sending failure notification to Multica autopilot webhook..." >&2
    local payload
    if command -v node >/dev/null 2>&1; then
      payload=$(node -e '
        const [msg, run] = process.argv.slice(1);
        console.log(JSON.stringify({job: "nightly-recompute", error: msg, run}));
      ' "$error_msg" "$run_pointer")
    elif command -v jq >/dev/null 2>&1; then
      payload=$(jq -nc --arg error "$error_msg" --arg run "$run_pointer" \
        '{job: "nightly-recompute", error: $error, run: $run}')
    else
      local escaped_msg
      escaped_msg=$(printf '%s' "$error_msg" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r\t' '   ')
      payload="{\"job\":\"nightly-recompute\",\"error\":\"$escaped_msg\",\"run\":\"$run_pointer\"}"
    fi

    curl -sS -m 10 -X POST "$webhook_url" \
      -H "content-type: application/json" \
      -d "$payload" >/dev/null 2>&1 || {
      echo "[WARN] Failed to deliver webhook notification to autopilot." >&2
    }
  fi
}

# ------------------------------------------------------------------------------
# Environment Detection (Host vs. Container Internal)
# ------------------------------------------------------------------------------
is_inside_container() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  if [[ -f "/app/server.js" && -f "/app/package.json" ]]; then
    return 0
  fi
  return 1
}

# ------------------------------------------------------------------------------
# Execution: Inside Container Mode
# ------------------------------------------------------------------------------
run_internal() {
  echo "[INFO] Running nightly recompute directly inside container environment..."
  local target_dir="/app"
  if [[ -d "/app" ]]; then
    cd /app
  elif [[ -d "web" ]]; then
    cd web
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would run: node scripts/nightly-recompute.mjs"
    exit 0
  fi

  exec node scripts/nightly-recompute.mjs
}

# ------------------------------------------------------------------------------
# Execution: Host VPS Mode (docker exec into target container)
# ------------------------------------------------------------------------------
run_on_host() {
  local container_id=""

  if [[ -n "$CONTAINER_OVERRIDE" ]]; then
    container_id="$CONTAINER_OVERRIDE"
  elif [[ -n "${CONTAINER_NAME:-}" ]]; then
    container_id="$CONTAINER_NAME"
  else
    # 1. Check standard compose container name
    container_id="$(docker ps -q -f "name=coffeemode-web-${TARGET_ENV}" | head -n 1 || true)"

    # 2. Check standard compose image/ancestor
    if [[ -z "$container_id" ]]; then
      container_id="$(docker ps -q --filter "ancestor=coffeemode-web-${TARGET_ENV}" | head -n 1 || true)"
    fi

    # 3. Check swarm service label
    if [[ -z "$container_id" ]]; then
      container_id="$(docker ps -q --filter "label=com.docker.swarm.service.name=coffeemode-web-${TARGET_ENV}" | head -n 1 || true)"
    fi

    # 4. Search running containers for image or name containing web-${TARGET_ENV}
    if [[ -z "$container_id" ]]; then
      container_id="$(docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}' | \
        awk -v env="$TARGET_ENV" '$2 ~ ("web-" env) || $3 ~ ("web-" env) {print $1; exit}' || true)"
    fi
  fi

  if [[ -z "$container_id" ]]; then
    local err="No running container found for environment '$TARGET_ENV'"
    echo "[ERROR] $err" >&2
    send_failure_alert "$err" "host:container-lookup"
    exit 1
  fi

  echo "[INFO] Found target container: $container_id ($TARGET_ENV)"

  local exec_cmd="cd /app && node scripts/nightly-recompute.mjs"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would execute: docker exec $container_id sh -c '$exec_cmd'"
    exit 0
  fi

  local output
  if output=$(docker exec "$container_id" sh -c "$exec_cmd" 2>&1); then
    echo "$output"
    echo "[OK] Nightly recompute and helpful ranking snapshot completed successfully in container $container_id."
    exit 0
  else
    local status=$?
    echo "$output" >&2
    local err_summary
    err_summary=$(echo "$output" | tail -n 5 | tr '\n' ' ')
    send_failure_alert "Docker exec failed in container $container_id: $err_summary" "docker-exec:$container_id"
    exit "$status"
  fi
}

# ------------------------------------------------------------------------------
# Main Dispatch
# ------------------------------------------------------------------------------
if is_inside_container; then
  run_internal
else
  run_on_host
fi
