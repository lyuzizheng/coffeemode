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

# 1. Structural checks (required harness/docs files exist)
echo "--- structural ---"
REQUIRED=(
  "AGENTS.md"
  "docs/README.md"
  "docs/STRUCTURE.md"
  "docs/specs/README.md"
  "docs/adr/README.md"
  "docs/agent/current-state.md"
  "docs/agent/implementation-slices.md"
  "docs/alignment-temp/alignment-progress.md"
  ".agents/README.md"
  ".agents/ROUTER.md"
  ".agents/rules/coding.md"
  ".agents/rules/issues.md"
  ".agents/workflows/closed-loop.md"
  ".agents/docs-semantic-review.md"
  ".codex/config.toml"
  ".codex/agents/explorer.toml"
  ".codex/agents/implementer.toml"
  ".codex/agents/reviewer.toml"
  ".codex/agents/tester.toml"
  ".github/workflows/ci.yml"
)
for f in "${REQUIRED[@]}"; do
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

# Ruby scripts parse
for script in "$SCRIPTS_DIR"/*.rb; do
  [[ -f "$script" ]] || continue
  if ruby -c "$script" >/dev/null 2>&1; then
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
echo ""

# 2. Doc consistency
run_gate "doc-consistency" "$SCRIPTS_DIR/check-docs-consistency.sh"

# 3. CI workflow structure
run_gate "ci-workflow" "$SCRIPTS_DIR/check-ci-workflow.sh"

# 4. Implementation slices (ruby validator)
run_gate "implementation-slices" "$SCRIPTS_DIR/check-implementation-slices.sh"

# 5. Markdown local links
run_gate "markdown-links" "$SCRIPTS_DIR/check-links.sh"

# 6. Repo-local agent skills
run_gate "agent-skills" "$SCRIPTS_DIR/check-agent-skills.sh"

# 7. Codex agent configuration
run_gate "codex-agents" "$SCRIPTS_DIR/check-codex-agents.sh"

# Summary
echo "===================="
if [[ $ERRORS -gt 0 ]]; then
  echo "Preflight FAILED with $ERRORS error(s)."
  exit 1
else
  echo "Preflight PASSED — all gates green."
fi
