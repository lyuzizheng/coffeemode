#!/usr/bin/env bash
# ==============================================================================
# Apply the effective Cloudflare edge cache ruleset (BRAWUKA-834).
#
# deploy/dokploy/cache-rules.json is the policy contract (generated from
# web/config/app.yaml seo.shellCache); this script applies the effective edge
# implementation in deploy/dokploy/cloudflare-cache-rules.json to the zone via
# the Cloudflare Rulesets API. The two files are deliberately separate: custom
# cache keys (varyOn / varyOnCookies) are Enterprise-only, so the effective
# ruleset enforces locale safety with bypass rules instead of cache-key inputs
# (see the file's $note and BRAWUKA-834).
#
# The entrypoint PUT replaces the whole phase ruleset, so the file is the single
# source of truth for what the edge runs and re-running is idempotent. Rule
# order is significant: Cloudflare evaluates rules in order and the last
# matching action wins, so the cache-eligible rule is last in the request phase
# and every bypass precedes it (BRAWUKA-836).
#
# Before any apply the payload is checked against the contract and against
# representative requests by scripts/devops/check-cache-policy.mjs, so a payload
# that drops a contract requirement, makes the cache-eligible rule unreachable,
# or names a phase other than the one it would be applied to cannot be applied.
#
# Usage:
#   ./apply-cache-rules.sh --dry-run [--phase request|response|all]
#   ./apply-cache-rules.sh --apply   [--phase request|response|all]
#
# Env (required for --apply):
#   CLOUDFLARE_API_TOKEN  Zone > Cache Rules > Edit
#   CLOUDFLARE_ZONE_ID    cafemood.app zone id
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RULES_FILE="${REPO_ROOT}/deploy/dokploy/cloudflare-cache-rules.json"

MODE=""
PHASE="all"

usage() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --dry-run) MODE="dry-run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --phase)
      PHASE="${2:?Error: --phase requires request, response, or all}"
      shift 2
      ;;
    --file)
      RULES_FILE="${2:?Error: --file requires a path}"
      shift 2
      ;;
    *)
      echo "Error: unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Error: pass --dry-run or --apply." >&2
  exit 1
fi

case "$PHASE" in
  request|response|all) ;;
  *)
    echo "Error: --phase must be request, response, or all (got '$PHASE')." >&2
    exit 1
    ;;
esac

if [[ ! -f "$RULES_FILE" ]]; then
  echo "Error: rules file not found: $RULES_FILE" >&2
  exit 1
fi

if ! jq -e . "$RULES_FILE" >/dev/null 2>&1; then
  echo "Error: rules file is not valid JSON: $RULES_FILE" >&2
  exit 1
fi

# The payload must implement the contract and every representative request must
# get the intended cache setting, so the applier reads the contract instead of
# trusting the effective file on its own. Fails closed: a missing checker or a
# missing node is an error, not a skipped step.
CHECKER="${SCRIPT_DIR}/check-cache-policy.mjs"
if [[ ! -f "$CHECKER" ]]; then
  echo "Error: policy checker not found: $CHECKER" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required to check the payload against the policy contract." >&2
  exit 1
fi
if ! node "$CHECKER" --payload "$RULES_FILE" >&2; then
  echo "Error: payload does not satisfy the cache policy contract; refusing to apply." >&2
  exit 1
fi

if [[ "$MODE" == "apply" ]]; then
  : "${CLOUDFLARE_API_TOKEN:?Error: CLOUDFLARE_API_TOKEN is required for --apply}"
  : "${CLOUDFLARE_ZONE_ID:?Error: CLOUDFLARE_ZONE_ID is required for --apply}"
fi

phases=()
if [[ "$PHASE" == "all" || "$PHASE" == "request" ]]; then
  phases+=(request)
fi
if [[ "$PHASE" == "all" || "$PHASE" == "response" ]]; then
  phases+=(response)
fi

applied=0
for phase in "${phases[@]}"; do
  if ! jq -e --arg p "$phase" '.[$p]' "$RULES_FILE" >/dev/null 2>&1; then
    echo "skip: no '${phase}' phase in ${RULES_FILE#"$REPO_ROOT"/}"
    continue
  fi

  api_phase="$(jq -r --arg p "$phase" '.[$p].phase' "$RULES_FILE")"
  payload="$(jq -c --arg p "$phase" '{description: .[$p].description, rules: .[$p].rules}' "$RULES_FILE")"
  url="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID:-<zone>}/rulesets/phases/${api_phase}/entrypoint"

  if [[ "$MODE" == "dry-run" ]]; then
    echo "PUT ${url}"
    jq --arg p "$phase" '.[$p]' "$RULES_FILE"
    applied=$((applied + 1))
    continue
  fi

  response="$(curl -sS -X PUT "$url" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$payload")"

  if [[ "$(jq -r '.success // false' <<<"$response" 2>/dev/null)" != "true" ]]; then
    echo "Error: Cloudflare rejected the ${phase} ruleset: $(jq -c '.errors // .' <<<"$response" 2>/dev/null || printf '%s' "$response")" >&2
    exit 1
  fi

  echo "ok: ${phase} ruleset applied (version $(jq -r '.result.version' <<<"$response"), $(jq -r '.result.rules | length' <<<"$response") rules)"
  applied=$((applied + 1))
done

if [[ "$applied" -eq 0 ]]; then
  echo "Error: no phases applied." >&2
  exit 1
fi
