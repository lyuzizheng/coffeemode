#!/usr/bin/env bash
# Harness self-test: copies the harness into a temp dir, injects faults,
# and verifies each check script detects them.
# Adapted from CanCan's harness-self-test.sh — same philosophy, fewer
# fault cases (coffeemode has no fixtures-private).
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/coffeemode-harness.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

# Copy harness-relevant files
cp -R docs .agents .github .codex AGENTS.md "$TEST_ROOT/" 2>/dev/null || true
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

# Assert an injected mutation actually changed the target file. A stale
# match string (sed/grep/awk anchor drifted) would otherwise no-op, leaving
# a valid file that the gate correctly passes — which then misreports as a
# harness MISS. This makes the real cause ("fixture is stale") explicit.
# Returns non-zero when the mutation did nothing so callers can skip the
# now-meaningless expect_failure.
assert_mutated() {
  local label="$1" original="$2" mutated="$3"
  if diff -q "$original" "$mutated" >/dev/null 2>&1; then
    echo "  STALE FIXTURE: mutation did not change file: $label"
    FAIL=$((FAIL + 1))
    return 1
  fi
  return 0
}

echo "=== Baseline: all checks pass on clean copy ==="
expect_pass "preflight" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/preflight.sh"
expect_pass "check-docs-consistency" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-docs-consistency.sh"
expect_pass "check-ci-workflow" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
expect_pass "check-implementation-slices" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-implementation-slices.sh"
expect_pass "check-links" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-links.sh"
expect_pass "check-agent-skills" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-agent-skills.sh"
expect_pass "check-codex-agents" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-codex-agents.sh"

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
if assert_mutated "spec missing from index" "$INDEX.bak" "$INDEX"; then
  expect_failure "spec missing from index" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-docs-consistency.sh"
fi
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

# Remove the real-DB command from the required integration workflow.
IWF="$TEST_ROOT/.github/workflows/integration.yml"
cp "$IWF" "$IWF.bak"
grep -v 'test:integration' "$IWF.bak" > "$IWF"
if assert_mutated "integration command missing" "$IWF.bak" "$IWF"; then
  expect_failure "integration workflow missing real-DB command" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
fi
mv "$IWF.bak" "$IWF"

# Remove the all-PR trigger; a required check must not be path-filtered away.
cp "$IWF" "$IWF.bak"
grep -v '^  pull_request:$' "$IWF.bak" > "$IWF"
if assert_mutated "integration pull_request trigger missing" "$IWF.bak" "$IWF"; then
  expect_failure "integration workflow missing all-PR trigger" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
fi
mv "$IWF.bak" "$IWF"

echo ""
echo "=== Fault injection: check-implementation-slices ==="

MANIFEST="$TEST_ROOT/docs/agent/implementation-slices.md"
cp "$MANIFEST" "$MANIFEST.bak"

# Reference a missing spec (manifest uses bare numbers like "0001")
sed 's/| 0001 |/| 9999 |/' "$MANIFEST.bak" > "$MANIFEST"
if assert_mutated "slice references missing spec" "$MANIFEST.bak" "$MANIFEST"; then
  expect_failure "slice references missing spec" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-implementation-slices.sh"
fi
mv "$MANIFEST.bak" "$MANIFEST"

# Invalid status — match ANY status cell (the manifest may legitimately have
# zero READY slices, e.g. when the last READY slice moves to IN-PROGRESS)
cp "$MANIFEST" "$MANIFEST.bak"
sed 's/| READY |/| UNKNOWN |/; s/| IN-PROGRESS |/| UNKNOWN |/; s/| BLOCKED |/| UNKNOWN |/; s/| COMPLETE |/| UNKNOWN |/' "$MANIFEST.bak" > "$MANIFEST"
if assert_mutated "invalid slice status" "$MANIFEST.bak" "$MANIFEST"; then
  expect_failure "invalid slice status" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-implementation-slices.sh"
fi
mv "$MANIFEST.bak" "$MANIFEST"

# READY slice with an active blocker
cp "$MANIFEST" "$MANIFEST.bak"
awk '/^\| scaffold-nextjs / { print "| scaffold-nextjs | Initialize Next.js workspace in web/ | READY | 0001, 0002 | none | missing MapKit key | typecheck, build | Next.js dev server and production build run in web/ |"; next } { print }' "$MANIFEST.bak" > "$MANIFEST"
if assert_mutated "READY slice with active blocker" "$MANIFEST.bak" "$MANIFEST"; then
  expect_failure "READY slice with active blocker" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-implementation-slices.sh"
fi
mv "$MANIFEST.bak" "$MANIFEST"

echo ""
echo "=== Fault injection: check-links ==="

# Inject a dangling local markdown link
PROBE_DOC="$TEST_ROOT/docs/adr/0001-nextjs-fullstack-rewrite.md"
cp "$PROBE_DOC" "$PROBE_DOC.bak"
printf '\nSee [missing doc](../agent/does-not-exist.md).\n' >> "$PROBE_DOC"
expect_failure "dangling markdown link" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-links.sh"
mv "$PROBE_DOC.bak" "$PROBE_DOC"

echo ""
echo "=== Fault injection: check-agent-skills ==="

# Skill with missing frontmatter
PROBE_SKILL="$TEST_ROOT/.agents/skills/broken-skill/SKILL.md"
mkdir -p "$(dirname "$PROBE_SKILL")"
printf '# No frontmatter here\n' > "$PROBE_SKILL"
expect_failure "skill missing frontmatter" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-agent-skills.sh"
rm -rf "$TEST_ROOT/.agents/skills/broken-skill"

# Skill name not matching directory
PROBE_SKILL2_DIR="$TEST_ROOT/.agents/skills/wrong-name-dir"
mkdir -p "$PROBE_SKILL2_DIR"
cat > "$PROBE_SKILL2_DIR/SKILL.md" <<'EOF'
---
name: different-name
description: Trigger probe for harness self-test. Use when testing.
---

# Probe
EOF
expect_failure "skill name/directory mismatch" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-agent-skills.sh"
rm -rf "$PROBE_SKILL2_DIR"

echo ""
echo "=== Fault injection: check-codex-agents ==="

# Break a codex agent TOML (invalid sandbox mode; implementer has no sandbox key by design)
TOML="$TEST_ROOT/.codex/agents/tester.toml"
cp "$TOML" "$TOML.bak"
sed 's/^sandbox_mode = .*/sandbox_mode = "everything"/' "$TOML.bak" > "$TOML"
expect_failure "invalid sandbox mode" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-codex-agents.sh"
mv "$TOML.bak" "$TOML"

# Missing required agent file
mv "$TEST_ROOT/.codex/agents/reviewer.toml" "$TEST_ROOT/.codex/agents/reviewer.toml.bak"
expect_failure "missing reviewer.toml" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-codex-agents.sh"
mv "$TEST_ROOT/.codex/agents/reviewer.toml.bak" "$TEST_ROOT/.codex/agents/reviewer.toml"

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
