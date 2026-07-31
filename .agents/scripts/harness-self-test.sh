#!/usr/bin/env bash
# Harness self-test: copies the harness into a temp dir, injects faults,
# and verifies each check script detects them.
# Adapted from CanCan's harness-self-test.sh — same philosophy, fewer
# fault cases (coffeemode has no .codex agents, no fixtures-private).
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/coffeemode-harness.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

# Copy harness-relevant files
cp -R docs .agents .github AGENTS.md "$TEST_ROOT/" 2>/dev/null || true
# Ensure git context for diff-based checks
(
  cd "$TEST_ROOT"
  git init -q
  git add .
  git -c user.name='Harness Self-Test' -c user.email='harness@test.invalid' commit -qm baseline
)

PASS=0
FAIL=0

run_check() {
  COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/$1" >/dev/null 2>&1
}

expect_pass() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  ok: $label"
    PASS=$((PASS + 1))
  else
    echo "  UNEXPECTED FAIL: $label"
    FAIL=$((FAIL + 1))
  fi
}

expect_failure() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  MISSED: harness failed to detect: $label"
    FAIL=$((FAIL + 1))
  else
    echo "  ok: detected injected fault: $label"
    PASS=$((PASS + 1))
  fi
}

echo "=== Baseline: all checks pass on clean copy ==="
expect_pass "preflight" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/preflight.sh"
expect_pass "check-docs-consistency" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-docs-consistency.sh"
expect_pass "check-ci-workflow" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
expect_pass "check-implementation-slices" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-implementation-slices.sh"

echo ""
echo "=== Fault injection: preflight ==="

# Remove a required file
mv "$TEST_ROOT/AGENTS.md" "$TEST_ROOT/AGENTS.md.bak"
expect_failure "missing AGENTS.md" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/preflight.sh"
mv "$TEST_ROOT/AGENTS.md.bak" "$TEST_ROOT/AGENTS.md"

# Duplicate spec number
cp "$TEST_ROOT/docs/specs/0001-nextjs-migration.md" "$TEST_ROOT/docs/specs/0001-duplicate.md"
expect_failure "duplicate spec number" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/preflight.sh"
rm "$TEST_ROOT/docs/specs/0001-duplicate.md"

echo ""
echo "=== Fault injection: check-docs-consistency ==="

# Inject trailing whitespace
printf 'trailing whitespace probe \n' >> "$TEST_ROOT/docs/README.md"
expect_failure "trailing whitespace" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-docs-consistency.sh"
# Restore
(cd "$TEST_ROOT" && git checkout -- docs/README.md)

# Remove spec from index
INDEX="$TEST_ROOT/docs/specs/README.md"
cp "$INDEX" "$INDEX.bak"
grep -v '0001-nextjs-migration.md' "$INDEX.bak" > "$INDEX"
expect_failure "spec missing from index" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-docs-consistency.sh"
mv "$INDEX.bak" "$INDEX"

echo ""
echo "=== Fault injection: check-ci-workflow ==="

# Break YAML
WF="$TEST_ROOT/.github/workflows/docs-harness.yml"
cp "$WF" "$WF.bak"
printf '\ninvalid: [\n' >> "$WF"
expect_failure "invalid workflow YAML" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
mv "$WF.bak" "$WF"

# Remove all harness script references from docs-harness
cp "$WF" "$WF.bak"
grep -v 'preflight\|harness-self-test\|check-docs' "$WF.bak" > "$WF"
expect_failure "docs-harness missing preflight" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
mv "$WF.bak" "$WF"

echo ""
echo "=== Fault injection: check-implementation-slices ==="

MANIFEST="$TEST_ROOT/docs/agent/implementation-slices.md"
cp "$MANIFEST" "$MANIFEST.bak"

# Reference a missing spec (manifest uses bare numbers like "0001")
sed 's/| 0001 |/| 9999 |/' "$MANIFEST.bak" > "$MANIFEST"
expect_failure "slice references missing spec" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-implementation-slices.sh"
mv "$MANIFEST.bak" "$MANIFEST"

# Invalid status (manifest uses uppercase READY)
cp "$MANIFEST" "$MANIFEST.bak"
sed 's/| READY |/| UNKNOWN |/' "$MANIFEST.bak" > "$MANIFEST"
expect_failure "invalid slice status" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-implementation-slices.sh"
mv "$MANIFEST.bak" "$MANIFEST"

echo ""
echo "=== Fault injection: shell syntax ==="

PROBE="$TEST_ROOT/.agents/scripts/syntax-probe.sh"
printf '#!/usr/bin/env bash\nif then\n' > "$PROBE"
expect_failure "invalid shell syntax" bash -n "$PROBE"
rm "$PROBE"

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "HARNESS SELF-TEST: FAILED"
  exit 1
fi
echo "HARNESS SELF-TEST: PASSED"
