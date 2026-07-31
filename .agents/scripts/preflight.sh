#!/usr/bin/env bash
# CoffeeMode Agent Preflight — master gate.
# Runs all deterministic harness checks in sequence.
# Exit non-zero on any failure.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERRORS=0

run_gate() {
  local name="$1" script="$2"
  echo "--- $name ---"
  if COFFEEMODE_ROOT="$ROOT" "$script"; then
    echo ""
  else
    ERRORS=$((ERRORS + 1))
    echo ""
  fi
}

echo "CoffeeMode preflight"
echo "===================="
echo ""

# 1. Structural checks (files exist, specs indexed, links resolve)
echo "--- structural ---"
for f in AGENTS.md docs/STRUCTURE.md docs/specs/README.md docs/agent/current-state.md docs/agent/implementation-slices.md .agents/ROUTER.md; do
  if [[ -f "$ROOT/$f" ]]; then
    echo "  ok: $f"
  else
    echo "  FAIL: $f missing"
    ERRORS=$((ERRORS + 1))
  fi
done

# Shell scripts parse
for script in "$SCRIPTS_DIR"/*.sh; do
  [[ -f "$script" ]] || continue
  if bash -n "$script" 2>/dev/null; then
    echo "  ok: $(basename "$script") parses"
  else
    echo "  FAIL: $(basename "$script") syntax error"
    ERRORS=$((ERRORS + 1))
  fi
done

# Spec numbers unique
SPEC_NUMS=$(grep -ohE '^# [0-9]{4}\.' docs/specs/[0-9]*.md 2>/dev/null | grep -oE '[0-9]{4}' | sort || true)
DUPES=$(echo "$SPEC_NUMS" | uniq -d)
if [[ -z "$DUPES" ]]; then
  echo "  ok: spec numbers unique"
else
  echo "  FAIL: duplicate spec numbers: $DUPES"
  ERRORS=$((ERRORS + 1))
fi

# Local markdown links resolve
BROKEN=0
while IFS= read -r line; do
  FILE=$(echo "$line" | cut -d: -f1)
  LINK=$(echo "$line" | grep -oE '\]\([^)]+\)' | head -1 | sed 's/\](\(.*\))/\1/')
  [[ "$LINK" == http* ]] && continue
  [[ "$LINK" == \#* ]] && continue
  DIR=$(dirname "$FILE")
  TARGET="$DIR/$LINK"
  TARGET="${TARGET%%#*}"
  [[ -z "$TARGET" ]] && continue
  if [[ ! -e "$TARGET" ]]; then
    echo "  FAIL: broken link in $(basename "$FILE"): $LINK"
    BROKEN=$((BROKEN + 1))
  fi
done < <(grep -rn '](\.\/' docs/ AGENTS.md .agents/ 2>/dev/null || true)
if [[ $BROKEN -eq 0 ]]; then
  echo "  ok: local links resolve"
else
  ERRORS=$((ERRORS + BROKEN))
fi
echo ""

# 2. Doc consistency
run_gate "doc-consistency" "$SCRIPTS_DIR/check-docs-consistency.sh"

# 3. CI workflow structure
run_gate "ci-workflow" "$SCRIPTS_DIR/check-ci-workflow.sh"

# 4. Implementation slices
run_gate "implementation-slices" "$SCRIPTS_DIR/check-implementation-slices.sh"

# Summary
echo "===================="
if [[ $ERRORS -gt 0 ]]; then
  echo "Preflight FAILED with $ERRORS error(s)."
  exit 1
else
  echo "Preflight PASSED — all gates green."
fi
