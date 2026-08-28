#!/usr/bin/env bash
# Validate CoffeeMode's unified, changed-path-aware CI workflow.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

fail=0
workflow=".github/workflows/ci.yml"

echo "Checking workflow YAML validity..."
for candidate in .github/workflows/*.yml; do
  [[ -f "$candidate" ]] || continue
  if command -v python3 >/dev/null 2>&1 && python3 -c "import yaml" 2>/dev/null; then
    python3 -c "import yaml; yaml.safe_load(open('$candidate', encoding='UTF-8'))" 2>/dev/null || {
      echo "Invalid YAML: $candidate"
      fail=1
    }
  elif command -v ruby >/dev/null 2>&1; then
    ruby -ryaml -e "YAML.safe_load(File.read('$candidate', encoding: 'UTF-8'))" 2>/dev/null || {
      echo "Invalid YAML: $candidate"
      fail=1
    }
  else
    echo "No YAML parser available."
    fail=1
  fi
done

echo "Checking unified CI structure..."
if [[ ! -f "$workflow" ]]; then
  echo "Missing $workflow"
  fail=1
else
  for requirement in \
    "pull_request:" \
    "cancel-in-progress: true" \
    "classify-ci-paths.sh" \
    "preflight.sh" \
    "harness-self-test.sh" \
    "docs-gate:" \
    "application-gate:" \
    "integration-gate:" \
    "image-service-gate:" \
    "poi-service-gate:" \
    "ci-gate:"; do
    if ! grep -q "$requirement" "$workflow"; then
      echo "ci.yml missing requirement: $requirement"
      fail=1
    fi
  done

  for output in docs application integration image_service poi_service; do
    if ! grep -q "needs.changes.outputs.$output == 'true'" "$workflow"; then
      echo "ci.yml does not condition a job on $output changes"
      fail=1
    fi
  done

  for gate in "npm run typecheck" "npm run lint" "npm run check:i18n" "npm run test" "npm run build"; do
    if ! grep -q "$gate" "$workflow"; then
      echo "ci.yml missing application gate: $gate"
      fail=1
    fi
  done

  for requirement in "postgis/postgis:" "@sha256:" "npm run test:integration" "DATABASE_URL:" "pg_isready"; do
    if ! grep -q "$requirement" "$workflow"; then
      echo "ci.yml missing real-DB requirement: $requirement"
      fail=1
    fi
  done

  if grep -qE 'playwright install[[:space:]]*$|check:visual|continue-on-error:[[:space:]]*true' "$workflow"; then
    echo "ci.yml contains an unbounded browser install, visual gate, or allowed failure"
    fail=1
  fi
fi

echo "Checking removed split workflows stay removed..."
for removed in application docs-harness image-service integration poi-service visual; do
  if [[ -e ".github/workflows/$removed.yml" ]]; then
    echo "Split workflow must stay removed: .github/workflows/$removed.yml"
    fail=1
  fi
done

if [[ ! -x .agents/scripts/classify-ci-paths.sh ]]; then
  echo "CI classifier is missing or not executable"
  fail=1
fi

echo "Checking action versions are not deprecated..."
if grep -rnE 'actions/checkout@v[123]\b' .github/workflows --include='*.yml'; then
  echo "Deprecated checkout action found"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  echo "CI workflow check FAILED."
  exit 1
fi

echo "CI workflow check passed."
