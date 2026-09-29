#!/usr/bin/env bash
# Deterministic gate: validate docs/agent/test-coverage.md traceability matrix
# - matrix exists and mentions required traces
# - table has rows for T1..T26
# - every READY slice in docs/agent/implementation-slices.md has ≥1 row in §5
# - evidence references are real (BRAWUKA-746): every backticked `.ts`/`.tsx`/
#   `.mjs` proving file in a §1 row and in the §3 helper table exists under the
#   canonical roots; every gate alias in a §1 row's gate cell is a
#   web/package.json script; a row's declared layers equal the layer classes of
#   the gates it names. A row marked `manual` is exempt from the runnable-proof
#   checks and is reported as unenforced, so manual/historical entries cannot
#   read as CI coverage (non-current material belongs in §4, which is prose).
# Exit non-zero on any failure (preflight-style).
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

MATRIX="docs/agent/test-coverage.md"
SLICES="docs/agent/implementation-slices.md"
ERRORS=0

fail() { echo "  FAIL: $*"; ERRORS=$((ERRORS+1)); }
ok()   { echo "  ok: $*"; }

echo "--- check-coverage-matrix ---"

if [[ ! -f "$MATRIX" ]]; then
  echo "  FAIL: $MATRIX missing (S3 not landed)"
  exit 1
fi
ok "$MATRIX exists"

# Required traces (case-insensitive keywords that must appear)
REQUIRED_KEYWORDS=(
  "login Apple"
  "session refresh"
  "cafe create"
  "nearby list"
  "check-in lifecycle"
  "likes"
  "navigations"
  "image upload"
  "POI search"
  "404 recovery"
  "SEO"
  "rate limiting"
)
for kw in "${REQUIRED_KEYWORDS[@]}"; do
  if grep -qi -- "$kw" "$MATRIX"; then
    ok "keyword present: $kw"
  else
    fail "keyword missing in matrix: $kw"
  fi
done

# Columns check (header must contain Trace + Spec + Layer + Proving + Gate)
if grep -q "Trace" "$MATRIX" && grep -q "Proving file" "$MATRIX" && grep -q "Gate" "$MATRIX"; then
  ok "matrix header has required columns"
else
  fail "matrix header missing expected columns (Trace/Spec/Layer/Proving file/Gate)"
fi

# T1..T26 rows present — every required trace must have a table row `| T<n> |`
MISSING_T=0
for i in $(seq 1 26); do
  if grep -qE "^\| T${i} \|" "$MATRIX"; then
    ok "trace T${i} row present"
  else
    fail "trace T${i} row missing (expected '| T${i} |' in $MATRIX)"
    MISSING_T=$((MISSING_T+1))
  fi
done
if [[ $MISSING_T -eq 0 ]]; then
  ok "all 26 traces T1..T26 have rows"
fi

# Every READY slice has ≥1 row in §5
if [[ -f "$SLICES" ]]; then
  READY_IDS=$(awk -F'|' '
    NR>2 && $4 ~ /READY/ {
      gsub(/^[ \t]+|[ \t]+$/, "", $2);
      print $2
    }' "$SLICES" | tr -d ' ' )
  if [[ -z "$READY_IDS" ]]; then
    ok "no READY slices (nothing to cross-check)"
  else
    for sid in $READY_IDS; do
      if grep -qF "$sid" "$MATRIX"; then
        ok "READY slice $sid referenced in matrix"
      else
        fail "READY slice $sid has no row in $MATRIX §5"
      fi
    done
  fi
else
  fail "$SLICES missing, cannot cross-check READY slices"
fi

# Residual gaps section present
if grep -qi "Residual gaps" "$MATRIX"; then
  ok "residual gaps section present"
else
  fail "residual gaps section missing"
fi

# Helpers split section present
if grep -qi "Infra vs service helpers" "$MATRIX"; then
  ok "infra vs service helpers split documented"
else
  fail "helpers split section missing"
fi

# Efficiency note present
if grep -qi "no duplication via helpers" "$MATRIX"; then
  ok "efficiency notes present"
else
  fail "efficiency notes (no duplication via helpers) missing"
fi

# --- Evidence-reference validation (BRAWUKA-746) ---------------------------
# Enforced evidence lives in the structured cells: §1 rows (proving file + gate)
# and the §3 helper table. A reference there is a claim about the current tree,
# so it is checked instead of trusted. Rows marked `manual` are exempt from the
# runnable-proof checks and reported as unenforced; historical or otherwise
# non-runnable material belongs in §4 (residual gaps), which is prose and exempt.

CANONICAL_ROOTS=(
  "" "web/" "web/tests/" "web/tests/integration/" "web/tests/components/"
  "web/tests/devops/" "web/tests/helpers/" "web/tests/fixtures/"
  "web/scripts/" "web/scripts/lib/" "web/lib/" "web/lib/api/" "web/shared/"
  "web/config/" "docs/" "deploy/" "scripts/" "image-service/" "poi-service/"
)

backticked() { grep -oE '`[^`]+`' 2>/dev/null | tr -d '`' || true; }

ref_matches() {
  local ref="$1" root
  for root in "${CANONICAL_ROOTS[@]}"; do
    case "$ref" in
      *'*'*)
        compgen -G "$root$ref" 2>/dev/null || true
        ;;
      *)
        if [[ -f "$root$ref" ]]; then printf '%s\n' "$root$ref"; fi
        ;;
    esac
  done
}

matrix_section() { # $1 = literal heading, e.g. "## 1. Matrix"
  awk -v head="$1" 'index($0, head) == 1 { on = 1; next }
                    /^## / { on = 0 }
                    on' "$MATRIX"
}

gate_class() {
  case "$1" in
    test:integration*) printf 'integration' ;;
    test:unit)         printf 'component' ;;
    test:e2e)          printf 'browser' ;;
    *)                 printf '' ;;
  esac
}

scripts_block="$(sed -n '/"scripts"[[:space:]]*:/,/^[[:space:]]*}/p' web/package.json 2>/dev/null || true)"
GATE_ALIASES="$(printf '%s\n' "$scripts_block" | grep -oE '"[^"]+"[[:space:]]*:' | sed -E 's/^"//; s/"[[:space:]]*:$//' || true)"
if [[ -z "$GATE_ALIASES" ]]; then
  fail "web/package.json scripts unreadable (gate aliases cannot be validated)"
fi

MANUAL_ROW_IDS=""
MANUAL_ROW_COUNT=0

while IFS= read -r row; do
  [[ -n "$row" ]] || continue
  row_id="$(printf '%s\n' "$row" | awk -F'|' '{ gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2 }')"
  layers_cell="$(printf '%s\n' "$row" | awk -F'|' '{ print $5 }')"
  proving_cell="$(printf '%s\n' "$row" | awk -F'|' '{ print $6 }')"
  gate_cell="$(printf '%s\n' "$row" | awk -F'|' '{ print $7 }')"

  row_manual=0
  if printf '%s\n' "$gate_cell" | grep -qiE '(^|[^[:alnum:]_])manual([^[:alnum:]_]|$)'; then
    row_manual=1
    MANUAL_ROW_COUNT=$((MANUAL_ROW_COUNT + 1))
    MANUAL_ROW_IDS="$MANUAL_ROW_IDS $row_id"
  fi

  gate_tokens="$(printf '%s\n' "$gate_cell" | backticked | grep -E '^[a-z][a-z0-9:-]*$' || true)"
  if [[ -z "$gate_tokens" && "$row_manual" -eq 0 ]]; then
    fail "$row_id gate cell names no gate alias and no explicit 'manual' marker"
  fi
  while IFS= read -r gate; do
    [[ -n "$gate" ]] || continue
    if ! printf '%s\n' "$GATE_ALIASES" | grep -Fxq "$gate"; then
      fail "$row_id unknown gate alias: $gate (not a web/package.json script)"
    fi
  done <<< "$gate_tokens"

  if [[ "$row_manual" -eq 0 ]]; then
    declared=""
    while IFS= read -r layer; do
      [[ -n "$layer" ]] || continue
      case "$layer" in
        integration|component|browser) declared="$declared$layer
" ;;
        *) fail "$row_id unknown layer: $layer (expected integration|component|browser)" ;;
      esac
    done <<< "$(printf '%s\n' "$layers_cell" | backticked || true)"

    claimed=""
    while IFS= read -r gate; do
      [[ -n "$gate" ]] || continue
      klass="$(gate_class "$gate")"
      if [[ -z "$klass" ]]; then
        fail "$row_id gate alias has no layer class: $gate"
      else
        claimed="$claimed$klass
"
      fi
    done <<< "$gate_tokens"

    declared_norm="$(printf '%s\n' "$declared" | grep . | sort -u | tr '\n' ' ' | sed 's/ *$//' || true)"
    claimed_norm="$(printf '%s\n' "$claimed" | grep . | sort -u | tr '\n' ' ' | sed 's/ *$//' || true)"
    if [[ "$declared_norm" != "$claimed_norm" ]]; then
      fail "$row_id layers [$declared_norm] do not match gate classes [$claimed_norm]"
    fi

    while IFS= read -r ref; do
      [[ -n "$ref" ]] || continue
      if [[ -z "$(ref_matches "$ref")" ]]; then
        fail "$row_id proving file missing: $ref (no file under the canonical roots)"
      fi
    done <<< "$(printf '%s\n' "$proving_cell" | backticked | grep -E '\.(ts|tsx|mjs)$' || true)"
  fi
done <<< "$(matrix_section '## 1. Matrix' | grep -E '^\| T[0-9]' || true)"
ok "§1 rows validated: proving files exist, gate aliases resolve, layers match gates"

while IFS= read -r row; do
  [[ -n "$row" ]] || continue
  while IFS= read -r ref; do
    [[ -n "$ref" ]] || continue
    if [[ -z "$(ref_matches "$ref")" ]]; then
      fail "§3 helper table references missing file: $ref"
    fi
  done <<< "$(printf '%s\n' "$row" | backticked | grep -E '\.(ts|tsx|mjs)$' || true)"
done <<< "$(matrix_section '## 3. Infra vs service helpers split' | grep -E '^\|' || true)"
ok "§3 helper table references resolve"

if [[ "$MANUAL_ROW_COUNT" -gt 0 ]]; then
  ok "$MANUAL_ROW_COUNT manual-marked row(s) reported as unenforced:$MANUAL_ROW_IDS"
else
  ok "no manual-marked rows (every §1 row names a runnable gate)"
fi

# No worktree-state gate here: CI has a clean checkout and this previously
# inspected uncommitted `git diff --name-only HEAD` (a no-op in CI, noisy locally).
# The docker-compose mention below is doc context only.

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "check-coverage-matrix FAILED with $ERRORS error(s)."
  exit 1
fi
echo ""
echo "check-coverage-matrix PASSED."
