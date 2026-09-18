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
# Failure Hook & Notification Helper
# ------------------------------------------------------------------------------
send_failure_alert() {
  local error_msg="$1"
  local run_pointer="${2:-dokploy:cron:nightly-recompute}"
  local webhook_url="${MULTICA_AUTOPILOT_WEBHOOK_URL:-}"

  # Output structured error line (JSON) for monitoring sinks
  local json_log
  json_log=$(printf '{"job":"nightly-recompute","status":"failed","error":"%s","run":"%s","timestamp":"%s"}' \
    "$(echo "$error_msg" | tr '"\n\r\t' '    ' | sed 's/  */ /g')" \
    "$run_pointer" \
    "$TIMESTAMP")
  echo "$json_log" >&2

  if [[ -n "$webhook_url" ]]; then
    echo "[INFO] Sending failure notification to Multica autopilot webhook..." >&2
    local payload
    payload=$(printf '{"job":"nightly-recompute","error":"%s","run":"%s"}' \
      "$(echo "$error_msg" | tr '"\n\r\t' '    ' | sed 's/  */ /g')" \
      "$run_pointer")
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
  # If docker binary is missing or /app/server.js exists in working dir
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
  if [[ -d "web" ]]; then
    cd web
  elif [[ -d "/app" ]]; then
    cd /app
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Would run: npm run recompute:work-stats && npm run snapshot:helpful-ranking"
    exit 0
  fi

  local output
  if output=$(npm run recompute:work-stats 2>&1 && npm run snapshot:helpful-ranking 2>&1); then
    echo "$output"
    echo "[OK] Nightly recompute and helpful ranking snapshot finished successfully."
    exit 0
  else
    local status=$?
    echo "$output" >&2
    local err_summary
    err_summary=$(echo "$output" | tail -n 5 | tr '\n' ' ')
    send_failure_alert "Recompute execution failed inside container: $err_summary" "container:internal"
    exit "$status"
  fi
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
    # Auto-detect container by environment
    if [[ "$TARGET_ENV" == "staging" ]]; then
      # Check standard staging container names (compose or dokploy swarm appName)
      container_id="$(docker ps -q -f "name=coffeemode-web-staging" | head -n 1 || true)"
      if [[ -z "$container_id" ]]; then
        container_id="$(docker ps -q -f "name=app-copy-virtual-microchip-idd1w9" | head -n 1 || true)"
      fi
    else
      # Check standard production container names (compose or dokploy swarm appName)
      container_id="$(docker ps -q -f "name=coffeemode-web-prod" | head -n 1 || true)"
      if [[ -z "$container_id" ]]; then
        container_id="$(docker ps -q -f "name=app-bypass-solid-state-pixel-pyvr1z" | head -n 1 || true)"
      fi
    fi
  fi

  if [[ -z "$container_id" ]]; then
    local err="No running container found for environment '$TARGET_ENV'"
    echo "[ERROR] $err" >&2
    send_failure_alert "$err" "host:container-lookup"
    exit 1
  fi

  echo "[INFO] Found target container: $container_id ($TARGET_ENV)"

  local exec_cmd="if [ -d web ]; then cd web; elif [ -d /app ]; then cd /app; fi; npm run recompute:work-stats && npm run snapshot:helpful-ranking"

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
