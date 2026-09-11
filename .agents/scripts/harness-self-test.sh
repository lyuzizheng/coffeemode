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
# Classifier inputs: the registered suites (`web/package.json`), the
# `RUN_INTEGRATION` test sources it must route to `integration-gate`, and the
# vitest config whose `setupFiles`/`resolve.alias` define the import closure
# rooted at those sources (BRAWUKA-206). The closure now *fails* on a specifier it
# cannot resolve, so the fixture must carry the whole tracked source tree those
# imports point at — not just `tests/` — or a fixture that is missing a module
# would look like a detector bug. Tracked files only: no `node_modules`, no
# `.next`, no coverage output.
mkdir -p "$TEST_ROOT/web"
(cd "$ROOT" && git ls-files -z web scripts | tar --null -T - -cf -) | (cd "$TEST_ROOT" && tar -xf -)
# Runtime-pin inputs: the manifests, lockfiles, Worker configs, Dockerfile and
# compose file `check-runtime-pins.sh` reads, plus the workflows it walks (copied
# with `.github/`). The gate treats any missing one as a failure (so it cannot
# half-run), which means the fixture must carry them — including the two service
# trees, which the classifier check does not need. `web/package-lock.json` and
# `web/Dockerfile` arrive with the tracked source tree above.
for svc in poi-service image-service; do
  mkdir -p "$TEST_ROOT/$svc"
  cp "$svc/package.json" "$svc/package-lock.json" "$svc/wrangler.toml" "$TEST_ROOT/$svc/" 2>/dev/null || true
done
cp docker-compose.yml "$TEST_ROOT/" 2>/dev/null || true
# Ensure git context for diff-based checks
(
  cd "$TEST_ROOT"
  git init -q
  git add .
  git -c user.name='Harness Self-Test' -c user.email='harness@test.invalid' \
    -c commit.gpgsign=false commit -qm baseline
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

# Like expect_failure, but the gate must also name the offending file: a drift
# attributed to the wrong package (or reported without a path) still exits
# nonzero, so exit status alone cannot prove the attribution is right.
expect_failure_matching() {
  local label="$1" pattern="$2"; shift 2
  local out
  if out="$("$@" 2>&1)"; then
    echo "  MISSED: harness failed to detect: $label"
    FAIL=$((FAIL + 1))
  elif grep -qF "$pattern" <<< "$out"; then
    echo "  ok: detected injected fault: $label"
    PASS=$((PASS + 1))
  else
    echo "  MISSED: fault detected but attribution wrong (no '$pattern'): $label"
    printf '%s\n' "$out" | head -5 | sed 's/^/    /'
    FAIL=$((FAIL + 1))
  fi
}

expect_classifier() {
  local label="$1" expected="$2"
  shift 2
  local actual
  actual="$(printf '%s\n' "$@" | "$TEST_ROOT/.agents/scripts/classify-ci-paths.sh")"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ok: $label"
    PASS=$((PASS + 1))
  else
    echo "  UNEXPECTED CLASSIFICATION: $label"
    echo "    expected: ${expected//$'\n'/, }"
    echo "    actual:   ${actual//$'\n'/, }"
    FAIL=$((FAIL + 1))
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
expect_pass "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
expect_pass "check-runtime-pins" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
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
WF="$TEST_ROOT/.github/workflows/ci.yml"
cp "$WF" "$WF.bak"
printf '\ninvalid: [\n' >> "$WF"
expect_failure "invalid workflow YAML" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
mv "$WF.bak" "$WF"

# Remove all harness script references from the docs job
cp "$WF" "$WF.bak"
grep -v 'preflight\|harness-self-test\|check-docs' "$WF.bak" > "$WF"
expect_failure "CI docs job missing preflight" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
mv "$WF.bak" "$WF"

# Remove the real-DB command from unified CI.
cp "$WF" "$WF.bak"
grep -v 'test:integration' "$WF.bak" > "$WF"
if assert_mutated "integration command missing" "$WF.bak" "$WF"; then
  expect_failure "integration workflow missing real-DB command" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
fi
mv "$WF.bak" "$WF"

# Each real-DB suite is its own step: deleting exactly one must be detected with
# its siblings still present, so `npm run test:integration` cannot stand in for
# `test:integration:journey` / `:http` / `:images` (BRAWUKA-148). The removal is
# line-anchored because the bare command is a prefix of the longer ones.
for step_command in \
  "npm run test:integration" \
  "npm run test:integration:journey" \
  "npm run test:integration:http" \
  "npm run test:integration:images" \
  "npm run test:coverage:integration"; do
  cp "$WF" "$WF.bak"
  grep -vE "^[[:space:]]*run:[[:space:]]*${step_command}[[:space:]]*$" "$WF.bak" > "$WF"
  if assert_mutated "step removed: $step_command" "$WF.bak" "$WF"; then
    expect_failure "integration step missing: $step_command" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
  fi
  mv "$WF.bak" "$WF"
done

# Remove changed-path conditioning from one stable job.
cp "$WF" "$WF.bak"
grep -v "needs.changes.outputs.integration == 'true'" "$WF.bak" > "$WF"
if assert_mutated "integration classifier condition missing" "$WF.bak" "$WF"; then
  expect_failure "integration job missing changed-path condition" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-workflow.sh"
fi
mv "$WF.bak" "$WF"

echo ""
echo "=== CI path classifier ==="

FALSES=$'application=false\nintegration=false\nimage_service=false\npoi_service=false'
expect_classifier "docs-only change" "$FALSES"$'\ndocs=true' "docs/STRUCTURE.md"
expect_classifier "web UI change" $'application=true\nintegration=false\nimage_service=false\npoi_service=false\ndocs=false' "web/app/page.tsx"
expect_classifier "web DB change" $'application=true\nintegration=true\nimage_service=false\npoi_service=false\ndocs=false' "web/lib/db/checkins.ts"
expect_classifier "shared package change" $'application=true\nintegration=true\nimage_service=true\npoi_service=true\ndocs=false' "packages/common/src/auth.ts"
expect_classifier "CI authority change" $'application=true\nintegration=true\nimage_service=true\npoi_service=true\ndocs=true' ".github/workflows/ci.yml"
expect_classifier "future workflow authority change" $'application=true\nintegration=true\nimage_service=true\npoi_service=true\ndocs=true' ".github/workflows/security.yml"
expect_classifier "generated agent adapter change" "$FALSES"$'\ndocs=true' "web/AGENTS.md"
# Integration-gated paths must schedule `integration-gate` (BRAWUKA-173): these
# files hold `RUN_INTEGRATION` cases, so an application-only classification would
# report green while the gated specs never ran.
INTEGRATION_GATED=$'application=true\nintegration=true\nimage_service=false\npoi_service=false\ndocs=false'
expect_classifier "gated devops suite" "$INTEGRATION_GATED" "web/tests/devops/staging-journey.test.ts"
expect_classifier "gated test helper entrypoint" "$INTEGRATION_GATED" "web/tests/db-helpers.test.ts"
expect_classifier "gated integration suite" "$INTEGRATION_GATED" "web/tests/integration/db.integration.test.ts"
# A suite's harness runs only where the suite runs, so the fixture the journey
# suites read (and the setup file every suite loads) is gated too (BRAWUKA-206).
expect_classifier "journey fixture" "$INTEGRATION_GATED" "web/tests/fixtures/mock-dataset.ts"
expect_classifier "suite setup file" "$INTEGRATION_GATED" "web/tests/setup.ts"
expect_classifier "stubbed server-only module" "$INTEGRATION_GATED" "web/tests/mocks/server-only.ts"
expect_classifier "sweeper module a gated suite drives" "$INTEGRATION_GATED" "web/scripts/cleanup-stale-test-dbs.mjs"
expect_classifier "shared runtime module a gated suite imports" "$INTEGRATION_GATED" "web/shared/uuid.ts"
# Everything else under `web/tests/**` that is not a test file is harness, so the
# default arm gates it however a suite reaches it — static import, dynamic import,
# or an `fs` read by path (BRAWUKA-206 review).
expect_classifier "harness file in an unclassified family" "$INTEGRATION_GATED" "web/tests/journey-support/probe-fixture.ts"
expect_classifier "harness data file in an unclassified family" "$INTEGRATION_GATED" "web/tests/journey-support/probe-fs.json"
expect_classifier "harness file beside a unit-only suite" "$INTEGRATION_GATED" "web/tests/components/component-fixture.ts"
# Unit-only test files are the one thing under `web/tests/**` that stays out, and
# only by explicit allowlist. Product configuration and gate scripts are gated:
# `web/lib/config.ts` loads the former at import time and the suites invoke the
# latter by path.
APPLICATION_ONLY=$'application=true\nintegration=false\nimage_service=false\npoi_service=false\ndocs=false'
expect_classifier "unit-only nested test file" "$APPLICATION_ONLY" "web/tests/shared/places/geo.test.ts"
expect_classifier "unit-only root test file" "$APPLICATION_ONLY" "web/tests/cafes.test.ts"
expect_classifier "product configuration" "$INTEGRATION_GATED" "web/config/app.yaml"
expect_classifier "gate script a suite invokes by path" "$INTEGRATION_GATED" "web/scripts/run-lhci.mjs"
# Explicitly ungated families must select nothing (documented no-gate decision).
expect_classifier "archived reference tree" "$FALSES"$'\ndocs=false' "_archive-coffeemode-frontend/src/App.tsx"
expect_classifier "raw dataset snapshot" "$FALSES"$'\ndocs=false' "database-data/cafes.json"

echo ""
echo "=== Fault injection: check-ci-classification ==="

CLASSIFIER_FIXTURE="$TEST_ROOT/.agents/scripts/classify-ci-paths.sh"

# A gated path dropped from the classifier's integration rule.
cp "$CLASSIFIER_FIXTURE" "$CLASSIFIER_FIXTURE.bak"
sed 's#|web/tests/devops/\*##' "$CLASSIFIER_FIXTURE.bak" > "$CLASSIFIER_FIXTURE"
if assert_mutated "gated path dropped from classifier" "$CLASSIFIER_FIXTURE.bak" "$CLASSIFIER_FIXTURE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$CLASSIFIER_FIXTURE.bak" "$CLASSIFIER_FIXTURE"

# A new RUN_INTEGRATION source outside the classified patterns — the exact miss
# this gate exists to catch.
PROBE_TEST_DIR="$TEST_ROOT/web/tests/harness-probe"
mkdir -p "$PROBE_TEST_DIR"
printf 'const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";\n' > "$PROBE_TEST_DIR/probe.test.ts"
expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
rm -rf "$PROBE_TEST_DIR"

# A new fixture under `web/tests/**`, reached the three ways a suite reaches its
# harness (BRAWUKA-206 review). The classifier's default for a non-test file in
# that tree is `integration-gate`, so none of these can land ungated — and the
# fault injection below proves the checker, not just the arm, holds that line.
CONSUMER_PROBE_DIR="$TEST_ROOT/web/tests/journey-support"
CONSUMER_SUITE="$TEST_ROOT/web/tests/integration/user-journey-discovery-creation.integration.test.ts"

# a) an ESM-style `.js` specifier naming a `.ts` fixture.
# b) an `fs` read by path, which no import rule can see.
mkdir -p "$CONSUMER_PROBE_DIR"
printf 'export const PROBE_ROWS = [{ id: "probe" }];\n' > "$CONSUMER_PROBE_DIR/probe-ext.ts"
printf '{"rows": [{"id": "probe"}]}\n' > "$CONSUMER_PROBE_DIR/probe-fs.json"
cp "$CONSUMER_SUITE" "$CONSUMER_SUITE.bak"
{
  printf 'import { PROBE_ROWS } from "../journey-support/probe-ext.js";\n'
  printf 'const PROBE_FS = JSON.parse(readFileSync(new URL("../journey-support/probe-fs.json", import.meta.url), "utf8"));\n'
  cat "$CONSUMER_SUITE.bak"
} > "$CONSUMER_SUITE"
if assert_mutated "gated suite reads a new fixture by .js specifier and by path" "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"; then
  expect_pass "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"
(cd "$TEST_ROOT" && git add web/tests/journey-support)

# The default arm is what makes those two forms safe, so narrowing it must be
# caught: the checker asserts the same property over tracked harness files
# whether or not any import points at them.
cp "$CLASSIFIER_FIXTURE" "$CLASSIFIER_FIXTURE.bak"
sed 's#^      web/tests/\*)$#      web/tests/__narrowed__*)#' "$CLASSIFIER_FIXTURE.bak" > "$CLASSIFIER_FIXTURE"
if assert_mutated "web/tests fail-safe default narrowed" "$CLASSIFIER_FIXTURE.bak" "$CLASSIFIER_FIXTURE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$CLASSIFIER_FIXTURE.bak" "$CLASSIFIER_FIXTURE"
rm -rf "$CONSUMER_PROBE_DIR"
(cd "$TEST_ROOT" && git rm -r -q --cached web/tests/journey-support 2>/dev/null || true)

# A fixture outside the test tree is only gated if the closure reaches it, so an
# ESM-style `.js` specifier naming a `.ts` source must be followed: without that
# mapping the fixture drops out of the closure and the gate stays green.
OUTSIDE_FIXTURE_DIR="$TEST_ROOT/web/probe-fixtures"
mkdir -p "$OUTSIDE_FIXTURE_DIR"
printf 'export const PROBE_ROWS = [{ id: "probe" }];\n' > "$OUTSIDE_FIXTURE_DIR/rows.ts"
cp "$CONSUMER_SUITE" "$CONSUMER_SUITE.bak"
printf 'import { PROBE_ROWS } from "../../probe-fixtures/rows.js";\n' | cat - "$CONSUMER_SUITE.bak" > "$CONSUMER_SUITE"
if assert_mutated "gated suite imports an out-of-tree fixture as .js" "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"
rm -rf "$OUTSIDE_FIXTURE_DIR"

# A specifier that names an in-repo file but resolves to nothing would shrink the
# closure silently, which is the failure this gate exists to stop.
cp "$CONSUMER_SUITE" "$CONSUMER_SUITE.bak"
printf 'import { PROBE_ROWS } from "../journey-support/does-not-exist";\n' | cat - "$CONSUMER_SUITE.bak" > "$CONSUMER_SUITE"
if assert_mutated "gated suite imports an unresolvable relative specifier" "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"

# A dynamic specifier whose static prefix does not route to the DB-backed gate
# cannot be judged, so it fails instead of passing quietly.
cp "$CONSUMER_SUITE" "$CONSUMER_SUITE.bak"
printf 'const PROBE_DYN = await import(`@/messages/${"en"}.json`);\n' | cat - "$CONSUMER_SUITE.bak" > "$CONSUMER_SUITE"
if assert_mutated "gated suite dynamically imports an ungated family" "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"

# The same dynamic form over a prefix that *is* gated needs no exemption: every
# child of it schedules the gate, so the check accepts it rather than demanding a
# routing decision for something already covered.
cp "$CONSUMER_SUITE" "$CONSUMER_SUITE.bak"
printf 'const PROBE_DYN = await import(`@/lib/db/${"search"}.ts`);\n' | cat - "$CONSUMER_SUITE.bak" > "$CONSUMER_SUITE"
if assert_mutated "gated suite dynamically imports a gated family" "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"; then
  expect_pass "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$CONSUMER_SUITE.bak" "$CONSUMER_SUITE"

# A path named in prose is not a dependency: a comment mentioning a unit-only
# test file must not drag it into the gated set.
COMMENT_SUITE="$TEST_ROOT/web/tests/integration/http-user-lifecycle.integration.test.ts"
cp "$COMMENT_SUITE" "$COMMENT_SUITE.bak"
printf '// see tests/components/checkin.test.tsx for the unit-level shape\n' | cat - "$COMMENT_SUITE.bak" > "$COMMENT_SUITE"
if assert_mutated "comment naming a unit-only test file" "$COMMENT_SUITE.bak" "$COMMENT_SUITE"; then
  expect_pass "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$COMMENT_SUITE.bak" "$COMMENT_SUITE"

# The closure is derived from the runner's own resolution rules, so it must fail
# loudly when it cannot follow one instead of silently shrinking the gated set.
VITEST_FIXTURE="$TEST_ROOT/web/vitest.config.mts"
cp "$VITEST_FIXTURE" "$VITEST_FIXTURE.bak"
sed 's#setupFiles: \["\./tests/setup\.ts"\]#setupFiles: ["@/tests/setup.ts"]#' "$VITEST_FIXTURE.bak" > "$VITEST_FIXTURE"
if assert_mutated "setupFiles switched to a specifier the closure cannot follow" "$VITEST_FIXTURE.bak" "$VITEST_FIXTURE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$VITEST_FIXTURE.bak" "$VITEST_FIXTURE"

cp "$VITEST_FIXTURE" "$VITEST_FIXTURE.bak"
sed 's#setupFiles: \["\./tests/setup\.ts"\]#setupFiles: ["./tests/setup.ts", "./tests/missing.ts"]#' "$VITEST_FIXTURE.bak" > "$VITEST_FIXTURE"
if assert_mutated "setupFiles declares a file that does not exist" "$VITEST_FIXTURE.bak" "$VITEST_FIXTURE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$VITEST_FIXTURE.bak" "$VITEST_FIXTURE"

cp "$VITEST_FIXTURE" "$VITEST_FIXTURE.bak"
sed 's#"server-only": path.resolve(import.meta.dirname, "\./tests/mocks/server-only\.ts"),#&\n      "@probe": path.resolve(__dirname, "./probe"),#' "$VITEST_FIXTURE.bak" > "$VITEST_FIXTURE"
if assert_mutated "resolve.alias entry the closure cannot follow" "$VITEST_FIXTURE.bak" "$VITEST_FIXTURE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$VITEST_FIXTURE.bak" "$VITEST_FIXTURE"

# A brand-new path family with no routing rule.
mkdir -p "$TEST_ROOT/newtop"
printf 'probe\n' > "$TEST_ROOT/newtop/file.txt"
(cd "$TEST_ROOT" && git add newtop/file.txt)
expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
rm -rf "$TEST_ROOT/newtop"

# A registered suite the real-DB coverage ratchet never measures.
PKG_FIXTURE="$TEST_ROOT/web/package.json"
cp "$PKG_FIXTURE" "$PKG_FIXTURE.bak"
sed 's# tests/db-helpers.test.ts tests/devops --config# tests/db-helpers.test.ts --config#' "$PKG_FIXTURE.bak" > "$PKG_FIXTURE"
if assert_mutated "coverage script no longer measures a registered suite" "$PKG_FIXTURE.bak" "$PKG_FIXTURE"; then
  expect_failure "check-ci-classification" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-ci-classification.sh"
fi
mv "$PKG_FIXTURE.bak" "$PKG_FIXTURE"

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

# Role bindings must stay thin instead of copying workflow procedure.
TOML="$TEST_ROOT/.codex/agents/implementer.toml"
cp "$TOML" "$TOML.bak"
awk '/^Follow `/ { print; print "State assumptions and success criteria before editing."; next } { print }' "$TOML.bak" > "$TOML"
expect_failure "duplicated Codex role procedure" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-codex-agents.sh"
mv "$TOML.bak" "$TOML"

# Missing required agent file
mv "$TEST_ROOT/.codex/agents/reviewer.toml" "$TEST_ROOT/.codex/agents/reviewer.toml.bak"
expect_failure "missing reviewer.toml" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-codex-agents.sh"
mv "$TEST_ROOT/.codex/agents/reviewer.toml.bak" "$TEST_ROOT/.codex/agents/reviewer.toml"

echo ""
echo "=== Fault injection: check-runtime-pins ==="

# One drift class per injection, each one a real way the repo drifted before
# (BRAWUKA-190): a per-package Node bump, a forked TypeScript major, a
# Worker date that would move with the platform.
PIN_PKG="$TEST_ROOT/poi-service/package.json"
cp "$PIN_PKG" "$PIN_PKG.bak"
sed 's/"node": ">=22"/"node": ">=24"/' "$PIN_PKG.bak" > "$PIN_PKG"
if assert_mutated "engines floor bumped in one package" "$PIN_PKG.bak" "$PIN_PKG"; then
  expect_failure "one package's engines floor diverges" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
fi
mv "$PIN_PKG.bak" "$PIN_PKG"

cp "$PIN_PKG" "$PIN_PKG.bak"
sed 's/"typescript": "\^5.9.3"/"typescript": "^7.0.2"/' "$PIN_PKG.bak" > "$PIN_PKG"
if assert_mutated "typescript major forked in one package" "$PIN_PKG.bak" "$PIN_PKG"; then
  expect_failure "typescript major forked" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
fi
mv "$PIN_PKG.bak" "$PIN_PKG"

# The lockfile, not just the manifest, must agree — otherwise "aligned" is a
# claim about package.json that the installed tree contradicts.
PIN_LOCK="$TEST_ROOT/poi-service/package-lock.json"
cp "$PIN_LOCK" "$PIN_LOCK.bak"
sed 's/"version": "5.9.3"/"version": "5.4.5"/' "$PIN_LOCK.bak" > "$PIN_LOCK"
if assert_mutated "lockfile resolves a different typescript" "$PIN_LOCK.bak" "$PIN_LOCK"; then
  expect_failure "lockfile typescript drift" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
fi
mv "$PIN_LOCK.bak" "$PIN_LOCK"

# A future date silently adopts compatibility flags as Cloudflare ships them,
# which is the drift the pin exists to stop.
PIN_WRANGLER="$TEST_ROOT/image-service/wrangler.toml"
cp "$PIN_WRANGLER" "$PIN_WRANGLER.bak"
sed 's/^compatibility_date = .*/compatibility_date = "2027-01-01"/' "$PIN_WRANGLER.bak" > "$PIN_WRANGLER"
if assert_mutated "compatibility_date moved into the future" "$PIN_WRANGLER.bak" "$PIN_WRANGLER"; then
  expect_failure "future compatibility_date" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
fi
mv "$PIN_WRANGLER.bak" "$PIN_WRANGLER"

# Unpinned at all: the old state this gate replaced.
cp "$PIN_WRANGLER" "$PIN_WRANGLER.bak"
grep -v '^compatibility_date = ' "$PIN_WRANGLER.bak" > "$PIN_WRANGLER"
if assert_mutated "compatibility_date removed" "$PIN_WRANGLER.bak" "$PIN_WRANGLER"; then
  expect_failure "compatibility_date missing" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
fi
mv "$PIN_WRANGLER.bak" "$PIN_WRANGLER"

# The pin lives in every workflow that provisions Node, not only in ci.yml: a
# nightly job that installs in web/ and recomputes against the production
# database shows the same drift (BRAWUKA-202).
PIN_NIGHTLY="$TEST_ROOT/.github/workflows/nightly-recompute.yml"
cp "$PIN_NIGHTLY" "$PIN_NIGHTLY.bak"
sed 's/^          node-version: 22$/          node-version: 24/' "$PIN_NIGHTLY.bak" > "$PIN_NIGHTLY"
if assert_mutated "nightly workflow pins a different Node major" "$PIN_NIGHTLY.bak" "$PIN_NIGHTLY"; then
  expect_failure "nightly workflow node-version drift" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
fi
mv "$PIN_NIGHTLY.bak" "$PIN_NIGHTLY"

# A workflow the gate has never seen is checked the same way, or "one more
# workflow" becomes the blind spot again.
PIN_NEW="$TEST_ROOT/.github/workflows/harness-probe.yml"
cat > "$PIN_NEW" <<'YAML'
name: Harness probe

on:
  workflow_dispatch:

jobs:
  probe:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - run: npm ci
YAML
expect_failure "new workflow with a drifted node-version" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"

# Installing a package while pinning nothing at all: the runner default would
# silently become the runtime that touches production.
cat > "$PIN_NEW" <<'YAML'
name: Harness probe

on:
  workflow_dispatch:

jobs:
  probe:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4

      - run: npm ci
YAML
expect_failure "workflow installing a package with no node-version" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
rm "$PIN_NEW"

# A non-npm install must be caught with the right attribution, not merely fail
# somehow: the probe file carries no working-directory or cache signal, so only
# the install step itself (`pnpm --dir web install`, space-form flag value —
# BRAWUKA-205) can attribute the drifted pin to web/. The assertion matches the
# probe path in the output, so a mis-attribution to another package counts as
# a miss rather than a pass.
PIN_PNPM="$TEST_ROOT/.github/workflows/probe-pnpm.yml"
cat > "$PIN_PNPM" <<'YAML'
name: Harness pnpm probe

on:
  workflow_dispatch:

jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - run: pnpm --dir web install
YAML
expect_failure_matching "pnpm install with space-form --dir drifted" ".github/workflows/probe-pnpm.yml" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"

# Same class, other manager and flag spelling: `yarn --cwd web install` must
# attribute to web/ as well.
cat > "$PIN_PNPM" <<'YAML'
name: Harness pnpm probe

on:
  workflow_dispatch:

jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - run: yarn --cwd web install
YAML
expect_failure_matching "yarn install with space-form --cwd drifted" ".github/workflows/probe-pnpm.yml" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/check-runtime-pins.sh"
rm "$PIN_PNPM"

# The preflight bridge must propagate the gate rather than swallow it.
cp "$TEST_ROOT/poi-service/package.json" "$TEST_ROOT/poi-service/package.json.keep"
sed 's/"node": ">=22"/"node": ">=24"/' "$TEST_ROOT/poi-service/package.json.keep" > "$TEST_ROOT/poi-service/package.json"
expect_failure "preflight propagates a failing runtime pin" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/preflight.sh"
mv "$TEST_ROOT/poi-service/package.json.keep" "$TEST_ROOT/poi-service/package.json"

echo ""
echo "=== Fault injection: structure guard ==="

# The preflight bridge must propagate a failing structure gate instead of
# swallowing it. The fixture has no package manager install, so stub the gate
# with a package.json script that always fails.
mkdir -p "$TEST_ROOT/web/node_modules/.bin"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TEST_ROOT/web/node_modules/.bin/eslint"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TEST_ROOT/web/node_modules/.bin/jscpd"
chmod +x "$TEST_ROOT/web/node_modules/.bin/eslint" "$TEST_ROOT/web/node_modules/.bin/jscpd"
printf '{"name":"web","private":true,"scripts":{"check:structure":"echo probe; exit 7"}}\n' > "$TEST_ROOT/web/package.json"
expect_failure "failing structure gate" env COFFEEMODE_ROOT="$TEST_ROOT" "$TEST_ROOT/.agents/scripts/preflight.sh"
rm -rf "$TEST_ROOT/web"

echo ""
echo "=== Fault injection: file-size ratchet registry staleness ==="

# The size registry (`structure-baseline.json.files`) is down-only: a file that
# shrank below its recorded count must fail until the entry is lowered, otherwise
# the old ceiling stays in force and the ratchet never tightens (spec 0009 §7.2).
mkdir -p "$TEST_ROOT/web/scripts" "$TEST_ROOT/web/components"
cp web/scripts/check-file-size.mjs "$TEST_ROOT/web/scripts/"
cp web/structure.config.mjs "$TEST_ROOT/web/"
seq 1 401 | sed 's/.*/export const value& = &;/' > "$TEST_ROOT/web/components/stale.tsx"

write_size_baseline() {
  printf '{\n  "files": [\n    { "path": "components/stale.tsx", "lines": %s, "reason": "harness-self-test fixture", "reviewBy": "2099-12-31" }\n  ]\n}\n' "$1" \
    > "$TEST_ROOT/web/structure-baseline.json"
}

write_size_baseline 401
expect_pass "file-size ratchet accepts a registry that matches the tree" \
  node "$TEST_ROOT/web/scripts/check-file-size.mjs"
write_size_baseline 402
expect_failure "file-size ratchet rejects a stale registry (401 lines recorded as 402)" \
  node "$TEST_ROOT/web/scripts/check-file-size.mjs"
rm -rf "$TEST_ROOT/web"

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
