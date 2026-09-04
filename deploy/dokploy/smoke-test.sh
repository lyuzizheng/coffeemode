#!/usr/bin/env bash
# ==============================================================================
# CoffeeMode Automated Smoke Test Suite
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
#
# Runs in-repo post-deployment verification without third-party SaaS dependencies.
#
# Usage:
#   ./smoke-test.sh [staging|prod] [BASE_URL_OVERRIDE]
#
# Examples:
#   ./smoke-test.sh staging
#   ./smoke-test.sh prod
#   ./smoke-test.sh staging http://127.0.0.1:3000
# ==============================================================================

set -euo pipefail

ENV="${1:-staging}"
URL_OVERRIDE="${2:-}"

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Error: Invalid environment '$ENV'. Must be 'staging' or 'prod'." >&2
  exit 1
fi

if [[ -n "$URL_OVERRIDE" ]]; then
  BASE_URL="$URL_OVERRIDE"
elif [[ "$ENV" == "staging" ]]; then
  BASE_URL="https://${STAGING_DOMAIN:-staging.coffeemode.app}"
else
  BASE_URL="https://${PROD_DOMAIN:-coffeemode.app}"
fi

# Remove trailing slash if provided
BASE_URL="${BASE_URL%/}"

FAILED=0
TOTAL=0

echo "=============================================================================="
echo "CoffeeMode Automated Smoke Test Suite"
echo "Target Environment: ${ENV}"
echo "Base URL:           ${BASE_URL}"
echo "Date (UTC):         $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=============================================================================="

assert_test() {
  local name="$1"
  local command="$2"
  TOTAL=$((TOTAL + 1))
  echo -n "[TEST ${TOTAL}] ${name}... "
  if eval "$command" >/dev/null 2>&1; then
    echo "PASS"
  else
    echo "FAIL"
    FAILED=$((FAILED + 1))
  fi
}

# 1. Healthcheck probe
assert_test "Healthcheck endpoint (/api/health)" \
  "curl -fsS -m 5 '${BASE_URL}/api/health' | grep -q '\"ok\":true'"

# 2. HTTP root render
assert_test "Root page render (/)" \
  "curl -fsS -m 10 '${BASE_URL}/' | grep -qi 'CoffeeMode'"

# 3. PostGIS database query via cafes API (lat/lng + radius_km, returns { cafes: [...] })
assert_test "PostGIS spatial query (/api/cafes?lat=1.3521&lng=103.8198&radius_km=5)" \
  "curl -fsS -m 10 '${BASE_URL}/api/cafes?lat=1.3521&lng=103.8198&radius_km=5' | grep -qE '\"cafes\":\s*\['"

# 4. Static assets & .next/static chunk resolution (verifies Docker standalone asset copy)
assert_test "Next.js standalone static asset resolution (/_next/static/)" \
  "ROOT_HTML=\$(curl -fsS -m 10 '${BASE_URL}/'); \
   STATIC_CHUNK=\$(echo \"\$ROOT_HTML\" | grep -oE '/_next/static/[^\"'\''>[:space:]]+\.(js|css)' | head -n 1); \
   [[ -n \"\$STATIC_CHUNK\" ]] && curl -fsS -m 5 -o /dev/null '${BASE_URL}\${STATIC_CHUNK}'"

# 5. Security headers verification
assert_test "Security header (X-Content-Type-Options: nosniff)" \
  "curl -fsS -m 5 -I '${BASE_URL}/api/health' | grep -qi 'x-content-type-options: nosniff'"

# 6. Cloudflare Worker POI service proxy
assert_test "POI service worker proxy (/api/places/search?q=coffee)" \
  "curl -fsS -m 10 '${BASE_URL}/api/places/search?q=coffee' | grep -qE '\"(results|pois|items)\":|\[\{\"'"

# 7. Cloudflare R2 Image CDN availability (verifies DNS, TLS, and edge reachability; fails on network drop/5xx)
if [[ "$ENV" == "prod" ]]; then
  IMAGE_HOST="https://images.coffeemode.app"
else
  IMAGE_HOST="https://staging-images.coffeemode.app"
fi
assert_test "Cloudflare R2 images CDN edge connectivity (${IMAGE_HOST})" \
  "STATUS=\$(curl -s -m 5 -o /dev/null -w '%{http_code}' '${IMAGE_HOST}/'); \
   [[ \"\$STATUS\" =~ ^(200|403|404)$ ]]"

echo "=============================================================================="
echo "Smoke Test Summary: $((TOTAL - FAILED))/${TOTAL} passed."

if [[ "$FAILED" -ne 0 ]]; then
  echo "CRITICAL: ${FAILED} smoke test(s) failed!" >&2
  exit 1
fi

echo "All smoke tests passed successfully."
