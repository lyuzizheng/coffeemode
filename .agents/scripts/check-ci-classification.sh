#!/usr/bin/env bash
# Deterministic gate: prove `.agents/scripts/classify-ci-paths.sh` routes every
# gate-relevant path to the CI job that actually executes it (BRAWUKA-173).
#
# Why this exists: a path whose rule omits `integration=true` makes CI skip
# `integration-gate` while `ci-gate` still reports green — a `RUN_INTEGRATION`
# suite "passes" without running. The recurring failure mode is a NEW gated test
# file landing outside `web/tests/integration/` or `web/tests/helpers/`, or a NEW
# fixture/harness module imported by one (BRAWUKA-206: a change to
# `web/tests/fixtures/mock-dataset.ts` scheduled `application-gate` alone while
# both journey suites read it). So this gate derives the gated set from the
# sources — suites, registered scripts, measured files, and their import
# closure — instead of trusting the pattern list, and enforces that every tracked
# path matches an explicit rule.
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

# 4b. Transitive consumers (BRAWUKA-206): a suite's harness is only proven where
#     the suite runs, so every module reachable from a gated source — its
#     fixtures, helper modules, and the shared runtime modules they pull in —
#     must schedule `integration-gate` too. The set comes from the import graph
#     rooted at the gated sources, not from the classifier's arm list, so the
#     next fixture or helper cannot land ungated.
VITEST_CONFIG="web/vitest.config.mts"
setup_files=()
import_aliases=""

if [[ -f "$VITEST_CONFIG" ]]; then
  # `setupFiles` runs ahead of every suite, the gated ones included. Every entry
  # must be a `./`-relative quoted path: an entry in any other form would drop
  # out of the closure silently, which is the whole failure this gate exists to
  # stop, so an unparsed entry is a hard failure rather than a smaller set.
  setup_block="$(awk '
    /setupFiles:[[:space:]]*\[/ { flag = 1 }
    flag {
      print
      depth += gsub(/\[/, "[")
      depth -= gsub(/\]/, "]")
      if (depth <= 0) exit
    }
  ' "$VITEST_CONFIG")"
  setup_entries="$(grep -oE '"\./[^"]+"' <<< "$setup_block" | tr -d '"' || true)"
  setup_declared="$(grep -oE '"[^"]+"' <<< "$setup_block" | wc -l | tr -d ' ')"
  setup_parsed="$(grep -c . <<< "$setup_entries" || true)"
  if [[ "$setup_declared" != "$setup_parsed" ]]; then
    fail "$VITEST_CONFIG setupFiles uses a form this check cannot follow ($setup_declared entries, $setup_parsed parsed) — use a \"./\"-relative path"
  fi
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    if [[ -f "web/${entry#./}" ]]; then
      setup_files+=("web/${entry#./}")
    else
      fail "$VITEST_CONFIG declares setup file $entry, which does not exist"
    fi
  done <<< "$setup_entries"

  # `resolve.alias` is what a specifier in a test actually loads, so the closure
  # follows the runner's own table rather than a second, drifting copy of it.
  # Same completeness rule: a table entry in a form the parser does not know
  # would silently shrink the closure, so it fails instead.
  alias_block="$(awk '
    /alias:[[:space:]]*\{/ { flag = 1 }
    flag {
      print
      depth += gsub(/\{/, "{")
      depth -= gsub(/\}/, "}")
      if (depth <= 0) exit
    }
  ' "$VITEST_CONFIG")"
  alias_declared="$(grep -c 'path\.resolve(' <<< "$alias_block" || true)"
  import_aliases="$(sed -nE 's/^[[:space:]]*"([^"]+)"[[:space:]]*:[[:space:]]*path\.resolve\(import\.meta\.dirname(,[[:space:]]*"([^"]*)")?[[:space:]]*\).*/\1\tweb\/\3/p' <<< "$alias_block")"
  alias_parsed="$(grep -c . <<< "$import_aliases" || true)"
  if [[ "$alias_declared" != "$alias_parsed" ]]; then
    fail "$VITEST_CONFIG resolve.alias uses a form this check cannot follow ($alias_declared entries, $alias_parsed parsed) — use path.resolve(import.meta.dirname[,...])"
  fi
else
  fail "$VITEST_CONFIG missing — cannot derive the suites' resolution rules"
fi

if [[ ${#setup_files[@]} -eq 0 ]]; then
  fail "no vitest setupFiles derived from $VITEST_CONFIG — the detector is broken"
fi
if [[ -z "$import_aliases" ]]; then
  fail "no resolve.alias derived from $VITEST_CONFIG — the detector is broken"
fi

# Drop one trailing path segment ("a/b" → "a", "a" → "").
normalize_path() {
  local path="$1" segment out="" IFS=/
  for segment in $path; do
    case "$segment" in
      ""|.) ;;
      ..) if [[ "$out" == */* ]]; then out="${out%/*}"; else out=""; fi ;;
      *) out="${out:+$out/}$segment" ;;
    esac
  done
  printf '%s' "$out"
}

# Resolve an import specifier to a repository file the way the runner does for
# in-repo forms: relative paths and the `resolve.alias` table. Package
# specifiers (node builtins, npm) resolve outside the tree and are not followed.
# A `.js`/`.mjs`/`.jsx` specifier may name a TypeScript source (the ESM-style
# specifier TypeScript and the bundler both accept), so those extensions are
# tried against `.ts`/`.tsx`/`.mts` too — without that, a gated suite importing
# its fixture as `…/probe.js` would take the fixture out of the closure silently
# (BRAWUKA-206 review).
resolve_import() {
  local from="$1" spec="$2" alias target base="" stem
  if [[ "$spec" == ./* || "$spec" == ../* ]]; then
    base="$(normalize_path "$(dirname "$from")/$spec")"
  else
    while IFS=$'\t' read -r alias target; do
      [[ -n "$alias" && -n "$target" ]] || continue
      if [[ "$spec" == "$alias" ]]; then
        base="$(normalize_path "$target")"
        break
      fi
      if [[ "$spec" == "$alias"/?* ]]; then
        base="$(normalize_path "$target/${spec#"$alias"/}")"
        break
      fi
    done <<< "$import_aliases"
  fi
  [[ -n "$base" ]] || return 0
  local candidates=("$base" "$base".ts "$base".tsx "$base".js "$base".mjs "$base".mts
    "$base".json "$base"/index.ts "$base"/index.tsx "$base"/index.js)
  case "$base" in
    *.js|*.mjs|*.cjs|*.jsx)
      stem="${base%.*}"
      candidates+=("$stem".ts "$stem".tsx "$stem".mts)
      ;;
  esac
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# Import specifiers only: a path named in prose (`// see tests/components/x.tsx`)
# is not a dependency, and treating it as one would fail a gate over a comment.
specifiers() {
  sed -E 's@^[[:space:]]*//.*@@; s@^[[:space:]]*\*.*@@; s@/\*.*\*/@@' "$1" 2>/dev/null |
    grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*[\"'][^\"']+[\"']" |
    sed -E "s/^[^\"']*[\"']([^\"']+)[\"']$/\1/" || true
}

# Dynamic specifiers (`import(\`../dir/${name}.ts\`)`) carry a static prefix and
# a computed tail, so the tail cannot be enumerated. The prefix is still a lower
# bound on where the target lives, so it is returned for the caller to judge.
dynamic_specifier_prefixes() {
  sed -E 's@^[[:space:]]*//.*@@' "$1" 2>/dev/null |
    grep -oE '(import|require)[[:space:]]*\([[:space:]]*[`][^`]*[`]' |
    sed -E 's@^[^(]*\([[:space:]]*[`]([^`]*)[`]$@\1@' || true
}

# The normalized in-repo base a specifier points at, without extension probing:
# a dynamic specifier's prefix names a directory, not a file.
resolve_base() {
  local from="$1" spec="$2" alias target
  spec="${spec%/}"
  if [[ "$spec" == ./* || "$spec" == ../* ]]; then
    normalize_path "$(dirname "$from")/$spec"
    return 0
  fi
  while IFS=$'\t' read -r alias target; do
    [[ -n "$alias" && -n "$target" ]] || continue
    if [[ "$spec" == "$alias" ]]; then
      normalize_path "$target"
      return 0
    fi
    if [[ "$spec" == "$alias"/?* ]]; then
      normalize_path "$target/${spec#"$alias"/}"
      return 0
    fi
  done <<< "$import_aliases"
  return 0
}

closure_roots="$gated"$'\n'
for file in ${registered_files[@]+"${registered_files[@]}"} ${measured_files[@]+"${measured_files[@]}"} ${setup_files[@]+"${setup_files[@]}"}; do
  closure_roots="$closure_roots$file"$'\n'
done

members=""
visited=$'\n'
queue="$closure_roots"
unresolved=""
dynamic_uncovered=""
while [[ -n "$queue" ]]; do
  file="${queue%%$'\n'*}"
  if [[ "$queue" == *$'\n'* ]]; then queue="${queue#*$'\n'}"; else queue=""; fi
  [[ -n "$file" ]] || continue
  if [[ "$visited" == *$'\n'"$file"$'\n'* ]]; then continue; fi
  visited="$visited$file"$'\n'
  members="$members$file"$'\n'
  case "$file" in
    *.ts|*.tsx|*.js|*.mjs|*.mts) ;;
    *) continue ;;
  esac
  while IFS= read -r spec; do
    [[ -n "$spec" ]] || continue
    # A specifier that names a file in this repository must be followable: if it
    # resolves to nothing, the closure would shrink silently, which is the whole
    # failure this gate exists to stop. Bare specifiers (node builtins, npm) and
    # alias-table missies are not in-repo by construction.
    if resolved="$(resolve_import "$file" "$spec")"; then
      if [[ "$visited" == *$'\n'"$resolved"$'\n'* ]]; then continue; fi
      queue="$queue$resolved"$'\n'
    elif [[ "$spec" == ./* || "$spec" == ../* || "$spec" == @/* || "$spec" == @shared/* || "$spec" == server-only ]]; then
      unresolved="$unresolved$file → $spec"$'\n'
    fi
  done < <(specifiers "$file")

  # A dynamic specifier's tail cannot be enumerated. Its static prefix is still a
  # lower bound: if *everything* under that prefix routes to `integration-gate`,
  # the target cannot land ungated whatever it names. The prefix is judged by
  # classifying a child of it, so a prefix that lands on a gated family (an alias
  # into `web/lib/**`, or a directory inside `web/tests/**`) is accepted and only
  # a genuinely undecidable one fails.
  while IFS= read -r dynamic; do
    [[ -n "$dynamic" ]] || continue
    prefix="${dynamic%%\$\{*}"
    resolved_prefix="$(resolve_base "$file" "$prefix")"
    if [[ -n "$resolved_prefix" ]] && grep -qx 'integration=true' <<< "$(classify "$resolved_prefix/__dynamic_probe__")"; then
      continue
    fi
    dynamic_uncovered="$dynamic_uncovered$file → $dynamic (static prefix '${resolved_prefix:-none}' does not route to integration-gate)"$'\n'
  done < <(dynamic_specifier_prefixes "$file")
done

if [[ -n "$unresolved" ]]; then
  fail "import specifiers the closure cannot resolve (a silent shrink is how a path lands ungated):"
  printf '%s\n' "$unresolved" | sed 's/^/    /'
fi
if [[ -n "$dynamic_uncovered" ]]; then
  fail "dynamic specifiers whose static prefix does not route to integration-gate:"
  printf '%s\n' "$dynamic_uncovered" | sed 's/^/    /'
fi

member_count=0
ungated=""
while IFS= read -r member; do
  [[ -n "$member" ]] || continue
  member_count=$((member_count+1))
  member_output="$(classify "$member")"
  if ! grep -qx 'integration=true' <<< "$member_output"; then
    ungated="$ungated$member (integration=false)"$'\n'
  fi
  # Everything under `web/` is also in scope for the unit/typecheck gate.
  if [[ "$member" == web/* ]] && ! grep -qx 'application=true' <<< "$member_output"; then
    ungated="$ungated$member (application=false)"$'\n'
  fi
done <<< "$members"

if [[ $member_count -eq 0 ]]; then
  fail "no import closure derived from the gated sources — the detector is broken"
elif [[ -z "$ungated" ]]; then
  ok "$member_count path(s) consumed by the gated suites route to integration-gate"
else
  fail "paths consumed by a RUN_INTEGRATION suite are not routed to integration-gate:"
  printf '%s\n' "$ungated" | sed 's/^/    /'
fi

# 4c. Harness files inside `web/tests/**`, independent of how a suite reaches
#     them (BRAWUKA-206 review). A fixture, helper, snapshot, or data file can be
#     read by static import, dynamic import, or `fs` by path; only the first is
#     visible to the import closure in 4b, so the invariant is asserted over the
#     files themselves: a test file may be unit-only, a non-test file is harness
#     and must schedule `integration-gate`. That is the same rule the
#     classifier's `web/tests/*` default arm encodes, so this step fails if that
#     arm is narrowed or reordered — the two cannot drift apart.
if git rev-parse --git-dir >/dev/null 2>&1; then
  harness_total=0
  harness_ungated=""
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      *.test.ts|*.test.tsx) continue ;;
    esac
    harness_total=$((harness_total+1))
    if ! grep -qx 'integration=true' <<< "$(classify "$path")"; then
      harness_ungated="$harness_ungated$path"$'\n'
    fi
  done <<< "$(git ls-files web/tests)"

  if [[ $harness_total -eq 0 ]]; then
    fail "no non-test files found under web/tests — the detector is broken"
  elif [[ -z "$harness_ungated" ]]; then
    ok "all $harness_total non-test file(s) under web/tests route to integration-gate"
  else
    fail "harness files a gated suite may read are not routed to integration-gate:"
    printf '%s\n' "$harness_ungated" | sed 's/^/    /'
  fi
else
  fail "not a git repository — cannot check the web/tests harness routing"
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
