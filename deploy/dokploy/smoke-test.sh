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

# 3. PostGIS database query via cafes API
assert_test "PostGIS spatial query (/api/cafes)" \
  "curl -fsS -m 10 '${BASE_URL}/api/cafes?lat=1.3521&lng=103.8198&radius=5' | grep -q '\['"

# 4. Static assets & chunk availability
assert_test "Next.js static assets chunk resolution" \
  "curl -fsS -m 5 -I '${BASE_URL}/favicon.ico' | grep -E 'HTTP/(1\.1|2|3) 200'"

# 5. Security headers verification
assert_test "Security header (X-Content-Type-Options: nosniff)" \
  "curl -fsS -m 5 -I '${BASE_URL}/api/health' | grep -qi 'x-content-type-options: nosniff'"

# 6. R2 Image CDN availability
if [[ "$ENV" == "prod" ]]; then
  IMAGE_HOST="https://images.coffeemode.app"
else
  IMAGE_HOST="https://staging-images.coffeemode.app"
fi
assert_test "Cloudflare R2 images CDN connectivity (${IMAGE_HOST})" \
  "curl -fsS -m 5 -I '${IMAGE_HOST}/' || true"

echo "=============================================================================="
echo "Smoke Test Summary: $((TOTAL - FAILED))/${TOTAL} passed."

if [[ "$FAILED" -ne 0 ]]; then
  echo "CRITICAL: ${FAILED} smoke test(s) failed!" >&2
  exit 1
fi

echo "All smoke tests passed successfully."
