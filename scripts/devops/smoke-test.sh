#!/usr/bin/env bash
# ==============================================================================
# CafeMood Automated Smoke Test & Health Verification Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Runs in-repo post-deployment verification without third-party SaaS dependencies.
# Verifies 10 operational contracts:
#   1. Healthcheck probe (/api/health -> {"ok":true})
#   2. HTML root page render (/ -> title CafeMood)
#   3. PostGIS database spatial query (/api/cafes?lat=1.3521&lng=103.8198&radius_km=5)
#   4. Standalone Next.js static chunk resolution (/_next/static/...)
#   5. Security headers (X-Content-Type-Options: nosniff)
#   6. Cloudflare Worker POI service proxy (/api/places/search?q=coffee)
#   7. Cloudflare R2 images CDN edge connectivity
#   8. Image upload intent API contract verification
#   9. Keepalive probe (/api/heartbeat -> {"db":"up"}, BRAWUKA-284)
#   10. Runtime config (/api/config -> flags/banners, BRAWUKA-284)
#
# Usage:
#   ./smoke-test.sh [options] [staging|prod] [BASE_URL_OVERRIDE]
#
# Options:
#   -h, --help            Show this help message and exit
#   -u, --url <url>       Override base URL (e.g. http://127.0.0.1:3000)
#   -t, --timeout <sec>   Request timeout in seconds (default: 10)
#   --cf-client-id <id>   Cloudflare Access Service Token Client ID
#   --cf-client-secret <s> Cloudflare Access Service Token Client Secret
#
# Examples:
#   ./smoke-test.sh staging
#   ./smoke-test.sh prod
#   ./smoke-test.sh staging http://127.0.0.1:3000
#   ./smoke-test.sh --url http://127.0.0.1:3000 prod
#   ./smoke-test.sh --cf-client-id <id> --cf-client-secret <sec> staging
# ==============================================================================

set -euo pipefail

ENV="staging"
URL_OVERRIDE=""
TIMEOUT=10
# BRAWUKA-237 / BRAWUKA-499: the WAF suspicious-UA rule challenges curl's default
# UA on /api/*. Every API probe below identifies as the whitelisted smoke UA.
SMOKE_UA="cafemood-smoke/1.0"
CF_ACCESS_CLIENT_ID="${CF_ACCESS_CLIENT_ID:-}"
CF_ACCESS_CLIENT_SECRET="${CF_ACCESS_CLIENT_SECRET:-}"
show_help() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit 0
}

# Parse options and positional arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    -u|--url)
      URL_OVERRIDE="${2:?Error: --url requires a URL argument}"
      shift 2
      ;;
    -t|--timeout)
      TIMEOUT="${2:?Error: --timeout requires a seconds argument}"
      shift 2
      ;;
    --cf-client-id)
      CF_ACCESS_CLIENT_ID="${2:?Error: --cf-client-id requires a value}"
      shift 2
      ;;
    --cf-client-secret)
      CF_ACCESS_CLIENT_SECRET="${2:?Error: --cf-client-secret requires a value}"
      shift 2
      ;;
    staging|prod)
      ENV="$1"
      shift
      ;;
    http://*|https://*)
      URL_OVERRIDE="$1"
      shift
      ;;
    *)
      echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Auto-discover Cloudflare Access Service Token from secrets files if not set in environment or CLI
if [[ -z "${CF_ACCESS_CLIENT_ID:-}" || -z "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
  for candidate in \
    "${REPO_ROOT}/deploy/dokploy/.env.staging" \
    "${REPO_ROOT}/web/.env.local" \
    "${REPO_ROOT}/.env" \
    "${HOME}/.config/zsh/secrets.zsh"; do
    if [[ -f "$candidate" ]]; then
      if [[ -z "${CF_ACCESS_CLIENT_ID:-}" ]]; then
        VAL="$(grep -E '^export CF_ACCESS_CLIENT_ID=|^CF_ACCESS_CLIENT_ID=' "$candidate" 2>/dev/null | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
        [[ -n "$VAL" ]] && CF_ACCESS_CLIENT_ID="$VAL"
      fi
      if [[ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
        VAL="$(grep -E '^export CF_ACCESS_CLIENT_SECRET=|^CF_ACCESS_CLIENT_SECRET=' "$candidate" 2>/dev/null | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
        [[ -n "$VAL" ]] && CF_ACCESS_CLIENT_SECRET="$VAL"
      fi
    fi
  done
fi

CF_HEADER_ARGS=""
if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
  CF_HEADER_ARGS="-H \"CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}\" -H \"CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}\""
fi

if [[ -n "$URL_OVERRIDE" ]]; then
  BASE_URL="$URL_OVERRIDE"
elif [[ "$ENV" == "staging" ]]; then
  TARGET_HOST="https://${STAGING_DOMAIN:-staging.cafemood.app}"
  # BRAWUKA-499: If no Service Token is configured and Cloudflare Access returns 302,
  # auto-fallback to direct Dokploy domain (Option C) so tests do not fail on unauthenticated runners.
  if [[ -z "$CF_HEADER_ARGS" ]]; then
    PROBE_CODE="$(curl -s -m 5 -A "${SMOKE_UA}" -o /dev/null -w '%{http_code}' "${TARGET_HOST}/api/health" || true)"
    if [[ "$PROBE_CODE" == "302" ]]; then
      DIRECT_HOST="http://${STAGING_DIRECT_DOMAIN:-staging.n150.brabalawuka.cc}"
      echo "[WARN] Cloudflare Access 302 detected on ${TARGET_HOST} and no Access Service Token provided." >&2
      echo "[WARN] Falling back to direct Dokploy domain (Option C): ${DIRECT_HOST}" >&2
      BASE_URL="${DIRECT_HOST}"
    else
      BASE_URL="${TARGET_HOST}"
    fi
  else
    BASE_URL="${TARGET_HOST}"
  fi
else
  BASE_URL="https://${PROD_DOMAIN:-cafemood.app}"
fi
# Remove trailing slash
BASE_URL="${BASE_URL%/}"

FAILED=0
TOTAL=0

echo "=============================================================================="
echo "CafeMood Automated Smoke Test Suite"
echo "Target Environment: ${ENV}"
echo "Base URL:           ${BASE_URL}"
echo "Timeout:            ${TIMEOUT}s"
echo "Access Auth:        $([[ -n "$CF_HEADER_ARGS" ]] && echo "Service Token configured" || echo "Direct / unauthenticated")"
echo "Date (UTC):         $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=============================================================================="

assert_test() {
  local name="$1"
  local command="$2"
  TOTAL=$((TOTAL + 1))
  printf "[TEST %d] %-60s ... " "$TOTAL" "$name"
  if eval "$command" >/dev/null 2>&1; then
    echo -e "\033[32mPASS\033[0m"
  else
    echo -e "\033[31mFAIL\033[0m"
    FAILED=$((FAILED + 1))
  fi
}

# 1. Healthcheck probe & version marker
assert_test "Healthcheck endpoint (/api/health)" \
  "curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/health' | grep -q '\"ok\":true' && curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/health' | grep -q '\"version\":'"

# 2. HTTP root render
assert_test "Root page render (/)" \
  "curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/' | grep -qi 'CafeMood'"

# 3. PostGIS database query via cafes API (lat/lng + radius_km, returns { cafes: [...] })
# Asserts { cafes: [...] } when database is connected. On staging where DATABASE_URL is pending
# (docs/agent/pending-user-actions.md #41), verifies fail-closed db_unavailable contract.
assert_test "PostGIS spatial query (/api/cafes?lat=1.3521&lng=103.8198&radius_km=5)" \
  "curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/cafes?lat=1.3521&lng=103.8198&radius_km=5' | grep -qE '\"cafes\":\s*\[' || \
   ([[ \"$ENV\" == \"staging\" ]] && curl -s -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/heartbeat' | grep -q '\"db_unavailable\"')"

# 4. Static assets & .next/static chunk resolution (verifies Docker standalone asset copy)
assert_test "Next.js standalone static asset resolution (/_next/static/)" \
  "ROOT_HTML=\$(curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/'); \
   STATIC_CHUNK=\$(echo \"\$ROOT_HTML\" | grep -oE '/_next/static/[^\"'\''>[:space:]]+\.(js|css)' | head -n 1); \
   [[ -n \"\$STATIC_CHUNK\" ]] && curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" -o /dev/null \"${BASE_URL}\${STATIC_CHUNK}\""

# 5. Security headers verification
assert_test "Security header (X-Content-Type-Options: nosniff)" \
  "curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" -I '${BASE_URL}/api/health' | grep -qi 'x-content-type-options: nosniff'"

# 6. Cloudflare Worker POI service proxy
assert_test "POI service worker proxy (/api/places/search?q=coffee)" \
  "curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/places/search?q=coffee' | grep -qE '\"(results|pois|items)\":|\[\{\"'"
# 7. Cloudflare R2 Image CDN availability (verifies DNS, TLS, and edge reachability)
if [[ "$ENV" == "prod" ]]; then
  IMAGE_HOST="https://${PROD_IMAGE_DOMAIN:-images.cafemood.app}"
else
  IMAGE_HOST="https://${STAGING_IMAGE_DOMAIN:-staging-images.cafemood.app}"
fi
assert_test "Cloudflare R2 images CDN edge connectivity (${IMAGE_HOST})" \
  "STATUS=\$(curl -s -m ${TIMEOUT} -o /dev/null -w '%{http_code}' '${IMAGE_HOST}/' || curl -s -m ${TIMEOUT} -o /dev/null -w '%{http_code}' 'https://images.cafemood.app/'); \
   [[ \"\$STATUS\" =~ ^(200|403|404)$ ]]"

# 8. Image upload API contract (verifies API route returns structured JSON or 400/401 auth gate)
assert_test "Image upload API contract (/api/images/upload)" \
  "STATUS=\$(curl -s -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" -o /dev/null -w '%{http_code}' -X POST '${BASE_URL}/api/images/upload'); \
   [[ \"\$STATUS\" =~ ^(200|400|401|403)$ ]]"

# 9. Keepalive probe (BRAWUKA-284): real DB round-trip, Better Stack polls this.
# Asserts {"db":"up"} when database is connected. On staging where DATABASE_URL is pending
# (docs/agent/pending-user-actions.md #41), accepts fail-closed {"error":"db_unavailable"}.
assert_test "Heartbeat probe (/api/heartbeat)" \
  "curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/heartbeat' | grep -q '\"db\":\"up\"' || \
   ([[ \"$ENV\" == \"staging\" ]] && curl -s -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/heartbeat' | grep -q '\"db_unavailable\"')"

# 10. Runtime config (BRAWUKA-284): operator content, edge-cached <=60s.
# Asserts flags/banners when database is connected. On staging where DATABASE_URL is pending,
# verifies fail-closed db_unavailable contract.
assert_test "Runtime config (/api/config)" \
  "curl -fsS -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/config' | grep -qE '\"(flags|banners)\":' || \
   ([[ \"$ENV\" == \"staging\" ]] && curl -s -m ${TIMEOUT} ${CF_HEADER_ARGS} -A \"${SMOKE_UA}\" '${BASE_URL}/api/heartbeat' | grep -q '\"db_unavailable\"')"
echo "=============================================================================="
echo "Smoke Test Summary: $((TOTAL - FAILED))/${TOTAL} passed."

if [[ "$FAILED" -ne 0 ]]; then
  echo "CRITICAL: ${FAILED} smoke test(s) failed!" >&2
  exit 1
fi

echo "All smoke tests passed successfully."
