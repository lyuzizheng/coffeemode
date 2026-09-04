#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Automated Smoke Test & Health Verification Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
#
# Runs in-repo post-deployment verification without third-party SaaS dependencies.
# Verifies 8 operational contracts:
#   1. Healthcheck probe (/api/health -> {"ok":true})
#   2. HTML root page render (/ -> title CoffeeMode)
#   3. PostGIS database spatial query (/api/cafes?lat=1.3521&lng=103.8198&radius_km=5)
#   4. Standalone Next.js static chunk resolution (/_next/static/...)
#   5. Security headers (X-Content-Type-Options: nosniff)
#   6. Cloudflare Worker POI service proxy (/api/places/search?q=coffee)
#   7. Cloudflare R2 images CDN edge connectivity
#   8. Image upload intent API contract verification
#
# Usage:
#   ./smoke-test.sh [options] [staging|prod] [BASE_URL_OVERRIDE]
#
# Options:
#   -h, --help            Show this help message and exit
#   -u, --url <url>       Override base URL (e.g. http://127.0.0.1:3000)
#   -t, --timeout <sec>   Request timeout in seconds (default: 10)
#
# Examples:
#   ./smoke-test.sh staging
#   ./smoke-test.sh prod
#   ./smoke-test.sh staging http://127.0.0.1:3000
#   ./smoke-test.sh --url http://127.0.0.1:3000 prod
# ==============================================================================

set -euo pipefail

ENV="staging"
URL_OVERRIDE=""
TIMEOUT=10

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

if [[ -n "$URL_OVERRIDE" ]]; then
  BASE_URL="$URL_OVERRIDE"
elif [[ "$ENV" == "staging" ]]; then
  BASE_URL="https://${STAGING_DOMAIN:-staging.coffeemode.app}"
else
  BASE_URL="https://${PROD_DOMAIN:-coffeemode.app}"
fi

# Remove trailing slash
BASE_URL="${BASE_URL%/}"

FAILED=0
TOTAL=0

echo "=============================================================================="
echo "CoffeeMode Automated Smoke Test Suite"
echo "Target Environment: ${ENV}"
echo "Base URL:           ${BASE_URL}"
echo "Timeout:            ${TIMEOUT}s"
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

# 1. Healthcheck probe
assert_test "Healthcheck endpoint (/api/health)" \
  "curl -fsS -m ${TIMEOUT} '${BASE_URL}/api/health' | grep -q '\"ok\":true'"

# 2. HTTP root render
assert_test "Root page render (/)" \
  "curl -fsS -m ${TIMEOUT} '${BASE_URL}/' | grep -qi 'CoffeeMode'"

# 3. PostGIS database query via cafes API (lat/lng + radius_km, returns { cafes: [...] })
assert_test "PostGIS spatial query (/api/cafes?lat=1.3521&lng=103.8198&radius_km=5)" \
  "curl -fsS -m ${TIMEOUT} '${BASE_URL}/api/cafes?lat=1.3521&lng=103.8198&radius_km=5' | grep -qE '\"cafes\":\s*\['"

# 4. Static assets & .next/static chunk resolution (verifies Docker standalone asset copy)
assert_test "Next.js standalone static asset resolution (/_next/static/)" \
  "ROOT_HTML=\$(curl -fsS -m ${TIMEOUT} '${BASE_URL}/'); \
   STATIC_CHUNK=\$(echo \"\$ROOT_HTML\" | grep -oE '/_next/static/[^\"'\''>[:space:]]+\.(js|css)' | head -n 1); \
   [[ -n \"\$STATIC_CHUNK\" ]] && curl -fsS -m ${TIMEOUT} -o /dev/null '${BASE_URL}\${STATIC_CHUNK}'"

# 5. Security headers verification
assert_test "Security header (X-Content-Type-Options: nosniff)" \
  "curl -fsS -m ${TIMEOUT} -I '${BASE_URL}/api/health' | grep -qi 'x-content-type-options: nosniff'"

# 6. Cloudflare Worker POI service proxy
assert_test "POI service worker proxy (/api/places/search?q=coffee)" \
  "curl -fsS -m ${TIMEOUT} '${BASE_URL}/api/places/search?q=coffee' | grep -qE '\"(results|pois|items)\":|\[\{\"'"

# 7. Cloudflare R2 Image CDN availability (verifies DNS, TLS, and edge reachability)
if [[ "$ENV" == "prod" ]]; then
  IMAGE_HOST="https://images.coffeemode.app"
else
  IMAGE_HOST="https://staging-images.coffeemode.app"
fi
assert_test "Cloudflare R2 images CDN edge connectivity (${IMAGE_HOST})" \
  "STATUS=\$(curl -s -m ${TIMEOUT} -o /dev/null -w '%{http_code}' '${IMAGE_HOST}/'); \
   [[ \"\$STATUS\" =~ ^(200|403|404)$ ]]"

# 8. Image upload intent API contract (verifies API route returns structured JSON or 401 auth gate)
assert_test "Image upload intent API contract (/api/images/upload-intent)" \
  "STATUS=\$(curl -s -m ${TIMEOUT} -o /dev/null -w '%{http_code}' -X POST '${BASE_URL}/api/images/upload-intent'); \
   [[ \"\$STATUS\" =~ ^(200|400|401|403)$ ]]"

echo "=============================================================================="
echo "Smoke Test Summary: $((TOTAL - FAILED))/${TOTAL} passed."

if [[ "$FAILED" -ne 0 ]]; then
  echo "CRITICAL: ${FAILED} smoke test(s) failed!" >&2
  exit 1
fi

echo "All smoke tests passed successfully."
