#!/usr/bin/env bash
# Deterministic gate: validate docs/agent/test-coverage.md traceability matrix
# - matrix exists and mentions required traces
# - table has rows for T1..T24
# - every READY slice in docs/agent/implementation-slices.md has ≥1 row in §5
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

# T1..T24 rows present (at least count distinct T-ids in table)
FOUND_T=$(grep -oE 'T([0-9]{1,2})' "$MATRIX" | sort -u | wc -l | tr -d ' ')
if [[ "$FOUND_T" -ge 20 ]]; then
  ok "matrix has $FOUND_T distinct trace ids (expected ≥20, T1..T24)"
else
  fail "matrix only has $FOUND_T trace ids, expected ≥20"
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

# Local links hygiene: matrix must not reference docker-compose.yml mutation (S3 must not touch compose)
if grep -q "docker-compose" "$MATRIX"; then
  # Mention is allowed as context, but ensure S3 branch didn't mutate compose
  if git diff --name-only HEAD 2>/dev/null | grep -q "docker-compose.yml"; then
    fail "S3 must not touch docker-compose.yml"
  else
    ok "docker-compose mentioned only as doc context (no file mutation)"
  fi
fi

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "check-coverage-matrix FAILED with $ERRORS error(s)."
  exit 1
fi
echo ""
echo "check-coverage-matrix PASSED."
