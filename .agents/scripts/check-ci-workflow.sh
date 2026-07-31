#!/usr/bin/env bash
# Validate CI workflow structure for CoffeeMode.
# Adapted from CanCan's check-ci-workflow.sh — checks YAML validity,
# required gates, branch coverage, and action versions.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

fail=0

echo "Checking workflow YAML validity..."
for wf in .github/workflows/*.yml; do
  [ -f "$wf" ] || continue
  NAME=$(basename "$wf")
  if command -v python3 &>/dev/null; then
    if ! python3 -c "import yaml; yaml.safe_load(open('$wf'))" 2>/dev/null; then
      echo "Invalid YAML: $NAME"
      fail=1
    fi
  elif command -v ruby &>/dev/null; then
    if ! ruby -ryaml -e "YAML.safe_load(File.read('$wf'))" 2>/dev/null; then
      echo "Invalid YAML: $NAME"
      fail=1
    fi
  else
    echo "  SKIP $NAME (no YAML parser available)"
  fi
done

echo "Checking docs-harness.yml runs preflight..."
if [ -f .github/workflows/docs-harness.yml ]; then
  if ! grep -q 'preflight\|check-docs-consistency\|harness-self-test' .github/workflows/docs-harness.yml; then
    echo "docs-harness.yml does not invoke any harness script"
    fail=1
  fi
  if ! grep -q 'main' .github/workflows/docs-harness.yml; then
    echo "docs-harness.yml missing main branch trigger"
    fail=1
  fi
else
  echo "docs-harness.yml missing"
  fail=1
fi

echo "Checking application.yml has required gates..."
if [ -f .github/workflows/application.yml ]; then
  for gate in "typecheck\|Typecheck" "lint\|Lint" "test\|Test" "build\|Build"; do
    if ! grep -qi "$gate" .github/workflows/application.yml; then
      echo "application.yml missing gate: $gate"
      fail=1
    fi
  done
  if ! grep -q 'cancel-in-progress: true' .github/workflows/application.yml; then
    echo "application.yml missing cancel-in-progress for superseded runs"
    fail=1
  fi
else
  echo "application.yml missing"
  fail=1
fi

echo "Checking action versions are not deprecated..."
for wf in .github/workflows/*.yml; do
  [ -f "$wf" ] || continue
  NAME=$(basename "$wf")
  # Flag checkout@v1/v2/v3 as deprecated (v4+ is current)
  if grep -qE 'actions/checkout@v[123]\b' "$wf"; then
    echo "$NAME uses deprecated actions/checkout version"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "CI workflow check FAILED."
  exit 1
fi

echo "CI workflow check passed."
