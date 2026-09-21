#!/usr/bin/env bash
# ==============================================================================
# CafeMood Grafana Cloud Loki log pipeline verification (BRAWUKA-607)
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Runbook:      docs/devops/grafana-cloud-logs.md
#
# Verifies the Alloy -> Loki pipeline from outside the VPS: it queries the
# Grafana Cloud Loki API and asserts the contracts the pipeline must uphold.
#
#   1. `web` streams exist for the environment
#   2. server-log.ts error / warn / access lines are present
#   3. `request_id` is structured metadata, not an index label
#   4. no per-request value leaked into the index label set (stream budget)
#   5. `debug` lines are dropped before shipping
#
# Usage:
#   ./verify-loki-logs.sh [options]
#
# Options:
#   -h, --help            Show this help message and exit
#   --env <prod|staging>  Environment to verify (default: prod)
#   --window <dur>        Lookback window, e.g. 24h, 7d (default: 24h)
#   --loki-url <url>      Override Loki base URL
#
# Credentials (never committed; see deploy/dokploy/.env.prod.example):
#   GRAFANA_LOKI_URL      push endpoint or base URL
#   GRAFANA_LOKI_USER     Loki instance ID
#   GRAFANA_LOKI_TOKEN    Grafana Cloud token with `logs:read`
#
# Examples:
#   GRAFANA_LOKI_USER=1795570 GRAFANA_LOKI_TOKEN=glc_... ./verify-loki-logs.sh
#   ./verify-loki-logs.sh --env staging --window 1h
# ==============================================================================

set -euo pipefail

ENV="prod"
WINDOW="24h"
LOKI_URL_OVERRIDE=""

show_help() {
  sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --env) ENV="${2:?--env requires a value}"; shift 2 ;;
    --window) WINDOW="${2:?--window requires a value}"; shift 2 ;;
    --loki-url) LOKI_URL_OVERRIDE="${2:?--loki-url requires a value}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; show_help >&2; exit 2 ;;
  esac
done

if [[ "$ENV" != "prod" && "$ENV" != "staging" ]]; then
  echo "ERROR: --env must be prod or staging (got '${ENV}')" >&2
  exit 2
fi

for bin in curl jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '${bin}' is required but not installed." >&2; exit 2; }
done

# Accept either the push endpoint or a bare base URL.
LOKI_BASE="${LOKI_URL_OVERRIDE:-${GRAFANA_LOKI_URL:-}}"
LOKI_BASE="${LOKI_BASE%/}"
LOKI_BASE="${LOKI_BASE%/loki/api/v1/push}"

if [[ -z "$LOKI_BASE" ]]; then
  echo "ERROR: set GRAFANA_LOKI_URL or pass --loki-url." >&2
  exit 2
fi
if [[ -z "${GRAFANA_LOKI_USER:-}" || -z "${GRAFANA_LOKI_TOKEN:-}" ]]; then
  echo "ERROR: GRAFANA_LOKI_USER and GRAFANA_LOKI_TOKEN must be set." >&2
  exit 2
fi

# Lookback window -> nanoseconds since epoch (BSD date on macOS, GNU date on Linux).
window_seconds() {
  local dur="$1" num unit
  num="${dur%[smhdw]}"; unit="${dur: -1}"
  [[ "$num" =~ ^[0-9]+$ ]] || return 1
  case "$unit" in
    s) echo "$num" ;;
    m) echo $((num * 60)) ;;
    h) echo $((num * 3600)) ;;
    d) echo $((num * 86400)) ;;
    w) echo $((num * 604800)) ;;
    *) return 1 ;;
  esac
}
WINDOW_SECONDS="$(window_seconds "$WINDOW")" \
  || { echo "ERROR: --window must look like 30m, 24h, 7d (got '${WINDOW}')" >&2; exit 2; }
NOW_S="$(date -u +%s)"
START_S=$((NOW_S - WINDOW_SECONDS))
END_NS="${NOW_S}000000000"
START_NS="${START_S}000000000"

loki_get() {
  local path="$1"; shift
  local args=()
  for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  curl -fsS -m 30 -u "${GRAFANA_LOKI_USER}:${GRAFANA_LOKI_TOKEN}" \
    -G "${LOKI_BASE}${path}" "${args[@]}"
}

FAILED=0
TOTAL=0

assert_test() {
  local name="$1" result="$2" detail="${3:-}"
  TOTAL=$((TOTAL + 1))
  if [[ "$result" == "0" ]]; then
    echo "  PASS  ${name}"
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL  ${name}"
    [[ -n "$detail" ]] && echo "        ${detail}"
  fi
}

echo "=============================================================================="
echo "CafeMood Loki Log Pipeline Verification"
echo "Environment:  ${ENV}"
echo "Loki:         ${LOKI_BASE}"
echo "Window:       ${WINDOW} (${START_S} -> ${NOW_S})"
echo "Date (UTC):   $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=============================================================================="

SELECTOR="{env=\"${ENV}\", service=\"web\"}"

# One series call drives every label assertion below. Note: Loki's
# /loki/api/v1/label/<name>/values endpoint ignores `match[]` (verified against
# Loki 3.6.0 — it returns every value of the label regardless of the matcher),
# so the label set is read off the series' own label sets instead.
SERIES_JSON="$(loki_get /loki/api/v1/series "match[]=${SELECTOR}" "start=${START_NS}" "end=${END_NS}" 2>/dev/null || echo '{"data":[]}')"
STREAM_COUNT="$(jq -r '.data | length' <<<"$SERIES_JSON" 2>/dev/null || echo 0)"

# 1. Streams exist at all.
assert_test "web streams exist for env=${ENV}" \
  "$([[ "${STREAM_COUNT:-0}" -gt 0 ]] && echo 0 || echo 1)" \
  "no series matched ${SELECTOR} in the last ${WINDOW} — is alloy-${ENV} running and shipping?"

# 2. The app's own line shapes are present.
LEVELS="$(jq -r '[.data[]?.level // empty] | unique | join(",")' <<<"$SERIES_JSON" 2>/dev/null || echo "")"
for want in error warn access; do
  assert_test "level=\"${want}\" lines present" \
    "$(grep -qE "(^|,)${want}(,|$)" <<<"$LEVELS" && echo 0 || echo 1)" \
    "level values seen: [${LEVELS}]"
done

# 3. debug lines are dropped before shipping (issue requirement: level != "debug").
assert_test "debug lines dropped before shipping" \
  "$(grep -qE '(^|,)debug(,|$)' <<<"$LEVELS" && echo 1 || echo 0)" \
  "level values seen: [${LEVELS}] — check stage.drop in deploy/dokploy/alloy/config.alloy"

# 4. No per-request value leaked into the index label set (stream budget guard).
#    service_name / detected_level are added by Loki itself; anything else is a bug.
LABELS="$(jq -r '[.data[]? | keys[]] | unique | join(",")' <<<"$SERIES_JSON" 2>/dev/null || echo "")"
UNEXPECTED="$(jq -r --argjson allowed '["container","env","level","service","service_name","detected_level"]' \
  '[.data[]? | keys[] | select(. as $l | $allowed | index($l) | not)] | unique | join(",")' <<<"$SERIES_JSON" 2>/dev/null || echo "")"
assert_test "index label set is bounded (no per-request labels)" \
  "$([[ -z "$UNEXPECTED" ]] && echo 0 || echo 1)" \
  "unexpected index labels: [${UNEXPECTED}] — a per-request value reached stage.labels"

# 5. request_id is structured metadata, not an index label.
assert_test "request_id is NOT an index label" \
  "$(grep -qE '(^|,)request_id(,|$)' <<<"$LABELS" && echo 1 || echo 0)" \
  "request_id appears in the index label set — it must stay structured metadata"

# 6. request_id is filterable as structured metadata. Needs a line that carries one,
#    so an empty window is a skip, not a failure.
SAMPLE_JSON="$(loki_get /loki/api/v1/query_range "query=${SELECTOR}" "limit=200" "start=${START_NS}" "end=${END_NS}" 2>/dev/null || echo '{"data":{"result":[]}}')"
SAMPLE_ID="$(jq -r '[.data.result[]?.values[]?[1] | fromjson? | .request_id // empty | select(length > 0)] | first // ""' <<<"$SAMPLE_JSON" 2>/dev/null || echo "")"
if [[ -z "$SAMPLE_ID" ]]; then
  echo "  SKIP  request_id is structured metadata (no line carried a request_id in this window)"
else
  HITS="$(loki_get /loki/api/v1/query_range "query=${SELECTOR} | request_id=\"${SAMPLE_ID}\"" "limit=5" "start=${START_NS}" "end=${END_NS}" 2>/dev/null \
    | jq -r '[.data.result[]?.values[]?] | length' 2>/dev/null || echo 0)"
  assert_test "request_id is structured metadata (filterable, sample ${SAMPLE_ID})" \
    "$([[ "${HITS:-0}" -gt 0 ]] && echo 0 || echo 1)" \
    "pipeline filter | request_id=\"${SAMPLE_ID}\" matched nothing"
fi

echo "=============================================================================="
echo "Loki Pipeline Verification Summary: $((TOTAL - FAILED))/${TOTAL} passed."

if [[ "$FAILED" -ne 0 ]]; then
  echo "FAILED: ${FAILED} check(s) did not pass."
  exit 1
fi

echo "All Loki pipeline checks passed."
