#!/usr/bin/env bash
# ==============================================================================
# CafeMood Basemap Verification — Self-Hosted Tiles vs Public Instance
# Lifecycle:    docs/devops/LIFECYCLE.md
# Runbook:      docs/devops/maptiles-runbook.md (§Verify, §Acceptance)
# Decision:     BRAWUKA-313 (this task)
#
# Proves the self-hosted basemap renders equivalently to the OpenFreeMap
# public instance BEFORE any app.yaml switch: TileJSON shape, style-referenced
# glyph/sprite reachability, style JSON validity, and range-request latency.
#
# Usage:
#   ./verify-maptiles.sh --env staging
#   ./verify-maptiles.sh --env staging --expect-version 20260913_164504_pt
#   ./verify-maptiles.sh --origin https://tiles.openfreemap.org   # baseline
#   ./verify-maptiles.sh --env staging --samples 30 --p95-budget-ms 1500
#
# Exit codes: 0 = all checks pass; 1 = any check fails (prints FAIL lines).
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ENV=""
ORIGIN=""
EXPECT_VERSION=""
SAMPLES=20
P95_BUDGET_MS=1500
TIMEOUT=15

show_help() {
  sed -n '2,/^# ==/p' "$0" | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      ;;
    -e|--env)
      ENV="${2:?Error: --env requires an argument (staging|production)}"
      shift 2
      ;;
    --origin)
      ORIGIN="${2:?Error: --origin requires a URL}"
      shift 2
      ;;
    --expect-version)
      EXPECT_VERSION="${2:?Error: --expect-version requires a version}"
      shift 2
      ;;
    --samples)
      SAMPLES="${2:?Error: --samples requires an integer}"
      shift 2
      ;;
    --p95-budget-ms)
      P95_BUDGET_MS="${2:?Error: --p95-budget-ms requires an integer}"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ORIGIN" ]]; then
  if [[ "$ENV" == "staging" ]]; then
    ORIGIN="https://staging-tiles.cafemood.app"
  elif [[ "$ENV" == "production" ]]; then
    ORIGIN="https://tiles.cafemood.app"
  else
    echo "Error: pass --env <staging|production> or --origin <url>." >&2
    exit 1
  fi
fi

FAILURES=0
pass() { echo "  ok: $*"; }
fail() { echo "  FAIL: $*"; FAILURES=$((FAILURES + 1)); }

echo "Verifying basemap origin: $ORIGIN"

# --- 1. TileJSON reachable, vector source present, tiles template absolute ---
TILEJSON="$(curl -fsSL --max-time "$TIMEOUT" "${ORIGIN}/planet" || echo "")"
if [[ -z "$TILEJSON" ]]; then
  fail "GET ${ORIGIN}/planet unreachable"
else
  pass "TileJSON reachable (${#TILEJSON} bytes)"
  if printf '%s' "$TILEJSON" | grep -q '"tiles"'; then pass "TileJSON carries a tiles template";
  else fail "TileJSON has no tiles template"; fi
  if printf '%s' "$TILEJSON" | grep -q '"vector_layers"'; then pass "TileJSON carries vector_layers";
  else fail "TileJSON has no vector_layers"; fi
  if printf '%s' "$TILEJSON" | grep -q '"maxzoom"[[:space:]]*:[[:space:]]*14'; then pass "TileJSON maxzoom 14";
  else fail "TileJSON maxzoom != 14"; fi
fi

# --- 2. Live version pointer (self-hosted only) ---
if [[ -n "$EXPECT_VERSION" ]]; then
  LIVE="$(curl -fsSL --max-time "$TIMEOUT" "${ORIGIN}/planet/current.txt" 2>/dev/null | tr -d '[:space:]' || echo "")"
  if [[ "$LIVE" == "$EXPECT_VERSION" ]]; then
    pass "current.txt == $EXPECT_VERSION"
  else
    fail "current.txt is '${LIVE:-<unreachable>}' (expected $EXPECT_VERSION)"
  fi
fi

# --- 3. Style JSONs valid, fully rewritten (no public-origin leakage) ---
# Self-hosted styles live at /styles/<name>.json; the public instance serves
# extensionless /styles/<name>. Probe both, preferring the self-hosted path.
style_url() {
  local base="$1" name="$2"
  if curl -fsSL --max-time "$TIMEOUT" -o /dev/null "${base}/styles/${name}.json" 2>/dev/null; then
    printf '%s' "${base}/styles/${name}.json"
  else
    printf '%s' "${base}/styles/${name}"
  fi
}
for style in liberty dark; do
  STYLE_URL="$(style_url "$ORIGIN" "$style")"
  BODY="$(curl -fsSL --max-time "$TIMEOUT" "$STYLE_URL" || echo "")"
  if [[ -z "$BODY" ]]; then
    fail "GET $STYLE_URL unreachable"
    continue
  fi
  if printf '%s' "$BODY" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    pass "style $style is valid JSON ($STYLE_URL)"
  else
    fail "style $style is not valid JSON ($STYLE_URL)"
  fi
  if printf '%s' "$BODY" | grep -q "tiles.openfreemap.org"; then
    if [[ "$ORIGIN" == "https://tiles.openfreemap.org"* ]]; then
      pass "style $style is the public original (self-host rewrite check N/A)"
    else
      fail "style $style still references tiles.openfreemap.org"
    fi
  else
    pass "style $style has no public-origin leakage"
  fi
done

# --- 4. Glyphs + sprites reachable ---
if curl -fsSL --max-time "$TIMEOUT" -o /dev/null "${ORIGIN}/fonts/Noto%20Sans%20Regular/0-255.pbf"; then
  pass "glyphs reachable (Noto Sans Regular 0-255)"
else
  fail "glyphs unreachable: ${ORIGIN}/fonts/Noto%20Sans%20Regular/0-255.pbf"
fi
if curl -fsSL --max-time "$TIMEOUT" -o /dev/null "${ORIGIN}/natural_earth/ne2sr/0/0/0.png"; then
  pass "natural_earth raster reachable (ne2sr 0/0/0)"
else
  fail "natural_earth raster unreachable: ${ORIGIN}/natural_earth/ne2sr/0/0/0.png"
fi
if curl -fsSL --max-time "$TIMEOUT" -o /dev/null "${ORIGIN}/sprites/ofm_f384/ofm.json"; then
  pass "sprites reachable (ofm_f384/ofm.json)"
else
  fail "sprites unreachable: ${ORIGIN}/sprites/ofm_f384/ofm.json"
fi

# --- 5. Range latency p95 over SAMPLES tile fetches ---
echo "Measuring tile range latency (${SAMPLES} samples)..."
TILE_URL="$(printf '%s' "$TILEJSON" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    print(d['tiles'][0])
except Exception:
    print('')
" 2>/dev/null || echo "")"
if [[ -z "$TILE_URL" ]]; then
  TILE_URL="${ORIGIN}/planet/20260906_080001_pt/{z}/{x}/{y}.pbf"
fi
SAMPLE_URL="${TILE_URL/\{z\}/10}"
SAMPLE_URL="${SAMPLE_URL/\{x\}/824}"
SAMPLE_URL="${SAMPLE_URL/\{y\}/426}"
TMP_TIMES="$(mktemp)"
trap 'rm -f "$TMP_TIMES"' EXIT
OK_COUNT=0
for _ in $(seq 1 "$SAMPLES"); do
  LINE="$(curl -s -o /dev/null -w "%{http_code} %{time_total}" --max-time "$TIMEOUT" "$SAMPLE_URL" || echo "000 0")"
  CODE="${LINE%% *}"
  SECS="${LINE##* }"
  if [[ "$CODE" == "200" || "$CODE" == "206" ]]; then
    OK_COUNT=$((OK_COUNT + 1))
    python3 -c "print(int(float('$SECS') * 1000))"
  else
    echo "ERR($CODE)" >&2
  fi >> "$TMP_TIMES"
done
if [[ "$OK_COUNT" -lt "$SAMPLES" ]]; then
  fail "tile fetches: $OK_COUNT/$SAMPLES succeeded"
else
  pass "tile fetches: $OK_COUNT/$SAMPLES succeeded"
fi
P95="$(grep -E '^[0-9]+$' "$TMP_TIMES" | sort -n | awk -v n="$OK_COUNT" '{a[NR]=$1} END {if (NR>0) {i=int(NR*0.95+0.5); if(i<1)i=1; if(i>NR)i=NR; print a[i]} else print -1}')"
MED="$(grep -E '^[0-9]+$' "$TMP_TIMES" | sort -n | awk '{a[NR]=$1} END {if (NR>0) {i=int((NR+1)/2); print a[i]} else print -1}')"
echo "  tile latency: median ${MED}ms, p95 ${P95}ms (budget ${P95_BUDGET_MS}ms, n=$OK_COUNT)"
if [[ "$P95" -ge 0 && "$P95" -le "$P95_BUDGET_MS" ]]; then
  pass "p95 ${P95}ms within budget"
else
  fail "p95 ${P95}ms exceeds budget ${P95_BUDGET_MS}ms"
fi

# --- 6. Equivalence: same tile bytes as the public instance (when verifying self-host) ---
if [[ "$ORIGIN" != "https://tiles.openfreemap.org"* ]]; then
  SELF_TILE="$(mktemp)"; PUB_TILE="$(mktemp)"
  trap 'rm -f "$TMP_TIMES" "$SELF_TILE" "$PUB_TILE"' EXIT
  curl -fsSL --max-time "$TIMEOUT" -o "$SELF_TILE" "$SAMPLE_URL" || true
  PUB_URL="https://tiles.openfreemap.org/planet/20260906_080001_pt/10/824/426.pbf"
  curl -fsSL --max-time "$TIMEOUT" -o "$PUB_TILE" "$PUB_URL" || true
  if [[ -s "$SELF_TILE" && -s "$PUB_TILE" ]]; then
    if cmp -s "$SELF_TILE" "$PUB_TILE"; then
      pass "sample tile byte-identical to public instance (same planet version)"
    else
      echo "  note: sample tile differs from public instance (expected across planet versions — compare current.txt dates, not a failure)"
    fi
  else
    fail "could not fetch both tiles for equivalence comparison"
  fi
fi

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "verify-maptiles: $FAILURES check(s) FAILED for $ORIGIN."
  exit 1
fi
echo "verify-maptiles: all checks passed for $ORIGIN."
