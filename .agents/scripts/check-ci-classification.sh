#!/usr/bin/env bash
# Deterministic gate: prove `.agents/scripts/classify-ci-paths.sh` routes every
# gate-relevant path to the CI job that actually executes it (BRAWUKA-173).
#
# Why this exists: a path whose rule omits `integration=true` makes CI skip
# `integration-gate` while `ci-gate` still reports green — a `RUN_INTEGRATION`
# suite "passes" without running. The recurring failure mode is a NEW gated test
# file landing outside `web/tests/integration/` or `web/tests/helpers/`, so this
# gate derives the gated set from the sources instead of trusting the pattern
# list, and enforces that every tracked path matches an explicit rule.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

CLASSIFIER=".agents/scripts/classify-ci-paths.sh"
PACKAGE_JSON="web/package.json"
ERRORS=0

fail() { echo "  FAIL: $*"; ERRORS=$((ERRORS+1)); }
ok()   { echo "  ok: $*"; }

echo "--- check-ci-classification ---"

if [[ ! -x "$CLASSIFIER" ]]; then
  fail "$CLASSIFIER missing or not executable"
  echo ""
  echo "check-ci-classification FAILED."
  exit 1
fi

classify() { printf '%s\n' "$@" | "$CLASSIFIER"; }

# Assert a path selects the given `key=value` flag line. The classifier output is
# captured once: piping it into `grep -q` would kill the writer with SIGPIPE and
# `pipefail` would then report the pipeline as failed.
expect_flag() {
  local label="$1" path="$2" flag="$3" output
  output="$(classify "$path")"
  if grep -qx "$flag" <<< "$output"; then
    ok "$label ($path → $flag)"
  else
    fail "$label: $path classifies as [$(tr '\n' ' ' <<< "$output")] — expected $flag"
  fi
}

# 1. Output contract: the workflow pipes stdout into `$GITHUB_OUTPUT`, so the
#    five keys must always be present in this order.
expected_output=$'application=true\nintegration=true\nimage_service=true\npoi_service=true\ndocs=true'
if [[ "$("$CLASSIFIER" --all)" == "$expected_output" ]]; then
  ok "--all forces every gate"
else
  fail "--all output drifted from the workflow's GITHUB_OUTPUT contract"
fi

if "$CLASSIFIER" --bogus >/dev/null 2>&1; then
  fail "unknown flag accepted (a typo like --al would silently disable classification)"
else
  ok "unknown flag rejected"
fi

# 2. Rule coverage: no tracked path may fall through to the catch-all. The
#    deliberately ungated families carry explicit empty arms, so every file in
#    the repository — present and future — has a written routing decision.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if unmatched="$(git ls-files | "$CLASSIFIER" --strict 2>&1 >/dev/null)"; then
    ok "every tracked path matches an explicit rule"
  else
    fail "tracked paths matched no rule:"
    printf '%s\n' "$unmatched" | sed 's/^/    /'
  fi
else
  fail "not a git repository — cannot check rule coverage over tracked paths"
fi

# 3. Registered suites: every `test:integration*` script file must run under a
#    gate that CI actually schedules (spec 0003: "register the file in the
#    matching test:integration:* script").
shopt -s nullglob
registered_files=()
measured_files=()
if [[ -f "$PACKAGE_JSON" ]]; then
  scripts_block="$(sed -n '/"scripts"[[:space:]]*:/,/^[[:space:]]*}/p' "$PACKAGE_JSON")"
  [[ -n "$scripts_block" ]] || scripts_block="$(cat "$PACKAGE_JSON")"

  while IFS= read -r token; do
    [[ -n "$token" ]] || continue
    # Unquoted expansion: a quoted `"$token"` would keep `*` literal, so a
    # registered glob (`tests/integration/http-*.integration.test.ts`) would
    # never expand to the files it stands for.
    matches=(web/$token)
    if [[ ${#matches[@]} -eq 0 ]]; then
      fail "registered suite matched no file: $token"
      continue
    fi
    for file in "${matches[@]}"; do
      registered_files+=("$file")
      expect_flag "registered integration suite" "$file" "integration=true"
    done
  done <<< "$(printf '%s\n' "$scripts_block" | grep -oE 'tests/[A-Za-z0-9_./*-]+\.test\.tsx?' | sort -u)"

  if [[ ${#registered_files[@]} -eq 0 ]]; then
    fail "no integration suite files found in $PACKAGE_JSON scripts"
  fi

  # 3b. The real-DB coverage ratchet must measure every registered suite: a
  #     suite that runs but is never measured leaves the `lib/db` ratchet blind
  #     to whatever covers it.
  coverage_script="$(printf '%s\n' "$scripts_block" | grep '"test:coverage:integration"' || true)"
  if [[ -z "$coverage_script" ]]; then
    fail "$PACKAGE_JSON has no test:coverage:integration script"
  else
    while IFS= read -r token; do
      [[ -n "$token" ]] || continue
      if [[ -d "web/$token" ]]; then
        while IFS= read -r file; do
          measured_files+=("$file")
        done < <(find "web/$token" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | sort)
      elif [[ -f "web/$token" ]]; then
        measured_files+=("web/$token")
      fi
    done <<< "$(printf '%s\n' "$coverage_script" | grep -oE 'tests/[A-Za-z0-9_./*-]+' | sort -u)"
  fi
else
  fail "$PACKAGE_JSON missing — cannot derive the registered integration suites"
fi
shopt -u nullglob

if [[ ${#registered_files[@]} -gt 0 && ${#measured_files[@]} -gt 0 ]]; then
  unmeasured="$(comm -23 \
    <(printf '%s\n' "${registered_files[@]}" | sort -u) \
    <(printf '%s\n' "${measured_files[@]}" | sort -u) || true)"
  if [[ -z "$unmeasured" ]]; then
    ok "test:coverage:integration measures all ${#registered_files[@]} registered suite file(s)"
  else
    fail "registered suites missing from test:coverage:integration:"
    printf '%s\n' "$unmeasured" | sed 's/^/    /'
  fi
fi

# 4. Gated sources: any test file that branches on `RUN_INTEGRATION` is skipped
#    by `npm test`, so it is only proven when `integration-gate` runs.
gated="$(grep -rlE 'RUN_INTEGRATION' --include='*.test.ts' --include='*.test.tsx' web/tests 2>/dev/null | sort || true)"
if [[ -z "$gated" ]]; then
  fail "no RUN_INTEGRATION test sources found — the detector is broken"
else
  gated_count=0
  while IFS= read -r file; do
    [[ -n "$file" ]] || continue
    gated_count=$((gated_count+1))
    expect_flag "RUN_INTEGRATION source" "$file" "integration=true"
    expect_flag "RUN_INTEGRATION source" "$file" "application=true"
  done <<< "$gated"
  ok "$gated_count RUN_INTEGRATION source(s) routed to integration-gate"
fi

# 5. The inverse invariant (spec 0003 acceptance: "a UI-only web change does not
#    start Postgres"): unit-only paths must stay out of the DB-backed gate.
expect_flag "unit-only route shell" "web/app/page.tsx" "integration=false"
expect_flag "unit-only component test" "web/tests/components/checkin.test.tsx" "integration=false"
expect_flag "unit-only mocked route test" "web/tests/profile/profile-route.test.ts" "integration=false"

# 6. Explicit policy for the ungated families (BRAWUKA-173 requirement 2): no
#    product code, script, or gate input reads them, so they must select nothing.
for path in "_archive-coffeemode-frontend/src/App.tsx" "_archive-coffeemode-backend/build.gradle" "database-data/cafes.json"; do
  if [[ "$(classify "$path" | sort -u)" == "application=false
docs=false
image_service=false
integration=false
poi_service=false" ]]; then
    ok "explicitly ungated: $path"
  else
    fail "$path must be explicitly ungated — got [$(classify "$path" | tr '\n' ' ')]"
  fi
done

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "check-ci-classification FAILED with $ERRORS error(s)."
  exit 1
fi

echo ""
echo "check-ci-classification PASSED."
