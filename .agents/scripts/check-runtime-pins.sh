#!/usr/bin/env bash
# Runtime pin gate (BRAWUKA-190): one Node major and one TypeScript version
# across `web/`, `poi-service/`, `image-service/`, and a frozen Worker
# `compatibility_date`.
#
# Why this exists: no package declared `engines`, the two Workers used
# TypeScript `^7` while `web/` used `^5`, and both Workers pinned
# `compatibility_date = "2024-01-01"`. So "which runtime and toolchain is this
# commit built against" was answered by whatever the local machine happened to
# have installed (CI pins Node 22; the containers pin `node:22-*`). This gate
# turns those pins into a declared, machine-checked contract: a change that
# moves one package, one container, or one Worker alone fails here instead of
# surfacing later as a machine-specific difference.
#
# What it deliberately does NOT check:
#   - `engine-strict`. Measured on npm 11: without it, an unsatisfiable
#     `engines` range is an `EBADENGINE` warning and `npm ci` still exits 0.
#     Turning it on would hard-fail local `npm ci` for a contributor on an
#     older Node and change nothing in CI (where the version is controlled), so
#     the pin is enforced by this gate, not by the installer.
#   - Equality between the two Workers' `compatibility_date` values. They carry
#     different runtime surface (image-service enables `nodejs_compat`,
#     poi-service does not), so both must be pinned, valid, and not in the
#     future — but each service adopting a newer runtime is a deliberate,
#     separate change by design.
set -euo pipefail

ROOT="${COFFEEMODE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

PACKAGES=(web poi-service image-service)
WORKERS=(poi-service image-service)
CI_WORKFLOW=".github/workflows/ci.yml"
WEB_DOCKERFILE="web/Dockerfile"
COMPOSE="docker-compose.yml"

ERRORS=0
fail() { echo "  FAIL: $*"; ERRORS=$((ERRORS+1)); }
ok()   { echo "  ok: $*"; }

echo "--- check-runtime-pins ---"

# Every input below is a file this repository must own; a missing one would
# otherwise turn a whole class of the check into a silent no-op. The harness
# self-test fixture copies all of them, so absence is a real failure, not a
# fixture artifact.
REQUIRED=()
for pkg in "${PACKAGES[@]}"; do
  REQUIRED+=("$pkg/package.json" "$pkg/package-lock.json")
done
for pkg in "${WORKERS[@]}"; do
  REQUIRED+=("$pkg/wrangler.toml")
done
REQUIRED+=("$CI_WORKFLOW" "$WEB_DOCKERFILE" "$COMPOSE")

for required in "${REQUIRED[@]}"; do
  if [[ ! -f "$required" ]]; then
    fail "missing $required — cannot verify the runtime pins"
  fi
done
if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "check-runtime-pins FAILED with $ERRORS error(s)."
  exit 1
fi

# --- 1. engines.node: same floor in every package, equal to CI and the images ---

# Reads the `"engines"` object out of a package.json (`awk`, so a one-line object
# works as well as the multi-line form).
engines_block() {
  awk '/"engines"[[:space:]]*:/{seen=1} seen{print} seen&&/\}/{exit}' "$1"
}

# The range grammar is intentionally narrow: a floor of `>=MAJOR[.MINOR[.PATCH]]`.
# Anything else (a caret, a disjunction, `*`) fails loudly rather than being
# mis-parsed into "consistent" — extend this gate when a real range is needed.
engine_floor() {
  local manifest="$1" line range
  line="$(engines_block "$manifest" | grep -E '"node"[[:space:]]*:' || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return 0
  fi
  range="$(printf '%s\n' "$line" | sed -nE 's/.*"node"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')"
  if [[ ! "$range" =~ ^\>=([0-9]+)(\.[0-9]+){0,2}$ ]]; then
    echo "unsupported-range:$range"
    return 0
  fi
  printf '%s\n' "${BASH_REMATCH[1]}"
}

node_floor=""
for pkg in "${PACKAGES[@]}"; do
  manifest="$pkg/package.json"
  floor="$(engine_floor "$manifest")"
  case "$floor" in
    "") fail "$manifest declares no engines.node" ; continue ;;
    unsupported-range:*)
      fail "$manifest engines.node \"${floor#unsupported-range:}\" is not a supported floor range (expected >=MAJOR[.MINOR[.PATCH]])"
      continue
      ;;
  esac
  if [[ -z "$node_floor" ]]; then
    node_floor="$floor"
  elif [[ "$floor" != "$node_floor" ]]; then
    fail "$manifest engines.node floor is $floor but ${PACKAGES[0]} declares $node_floor — one Node major across the repo"
    continue
  fi
  ok "$manifest engines.node >=$floor"
done

if [[ -z "$node_floor" ]]; then
  echo ""
  echo "check-runtime-pins FAILED with $ERRORS error(s)."
  exit 1
fi

# CI's `node-version` is the authoritative floor: every occurrence must agree,
# so neither an engines bump without CI nor a CI bump without engines passes.
ci_majors="$(grep -E '^[[:space:]]*node-version:' "$CI_WORKFLOW" |
  sed -nE 's/.*node-version:[[:space:]]*["'"'"']?([0-9]+).*/\1/p' | sort -u)"
if [[ -z "$ci_majors" ]]; then
  fail "$CI_WORKFLOW declares no node-version — the CI floor is unverifiable"
else
  while IFS= read -r major; do
    if [[ "$major" != "$node_floor" ]]; then
      fail "$CI_WORKFLOW pins node-version: $major but engines.node floors at >=$node_floor"
    else
      ok "$CI_WORKFLOW node-version: $major matches engines.node"
    fi
  done <<< "$ci_majors"
fi

# Containers are the other place the runtime is pinned: a Dockerfile or compose
# image that drifts from `engines` ships a different Node than CI tests.
check_image_majors() {
  local file="$1" pattern="$2" majors
  majors="$(grep -oE "$pattern" "$file" | sed -nE 's/.*node:([0-9]+).*/\1/p' | sort -u)"
  if [[ -z "$majors" ]]; then
    fail "$file declares no node image — the container runtime is unverifiable"
    return 0
  fi
  while IFS= read -r major; do
    if [[ "$major" != "$node_floor" ]]; then
      fail "$file uses a node:$major image but engines.node floors at >=$node_floor"
    else
      ok "$file node image major $major matches engines.node"
    fi
  done <<< "$majors"
}

check_image_majors "$WEB_DOCKERFILE" 'FROM[[:space:]]+node:[0-9]+[0-9a-z.-]*'
check_image_majors "$COMPOSE" 'image:[[:space:]]*node:[0-9]+[0-9a-z.-]*'

# --- 2. TypeScript: one declared range, one resolved version, in all three ---

ts_range=""
ts_resolved=""
ts_aligned=0
for pkg in "${PACKAGES[@]}"; do
  manifest="$pkg/package.json"
  lock="$pkg/package-lock.json"
  pkg_aligned=1

  range="$(sed -nE 's/.*"typescript"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$manifest" | head -1)"
  if [[ -z "$range" ]]; then
    fail "$manifest declares no typescript dependency"
    continue
  fi
  if [[ -z "$ts_range" ]]; then
    ts_range="$range"
  elif [[ "$range" != "$ts_range" ]]; then
    fail "$manifest declares typescript $range but ${PACKAGES[0]} declares $ts_range — one TypeScript version across the repo"
    pkg_aligned=0
  fi

  # lockfileVersion 3 puts `packages` first, so the first match is
  # `packages["node_modules/typescript"]`; its `version` is the next line. A
  # formatting change makes the extraction empty, which fails below instead of
  # passing silently.
  resolved="$(awk '/^[[:space:]]*"node_modules\/typescript":/{getline; print; exit}' "$lock" |
    sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')"
  if [[ ! "$resolved" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    fail "$lock: could not read the installed typescript version (got \"${resolved:-<empty>}\")"
    continue
  fi
  if [[ -z "$ts_resolved" ]]; then
    ts_resolved="$resolved"
  elif [[ "$resolved" != "$ts_resolved" ]]; then
    fail "$lock resolves typescript $resolved but the first package resolves $ts_resolved — lockfiles must agree"
    pkg_aligned=0
  fi

  # The declared range and the version the lockfile actually installs must be
  # the same major, or "aligned" is only a claim about package.json.
  declared_major="$(sed -nE 's/^[~^]?([0-9]+).*/\1/p' <<< "$range")"
  if [[ "$declared_major" != "${resolved%%.*}" ]]; then
    fail "$manifest declares typescript $range but $lock installs $resolved (major drift)"
    pkg_aligned=0
  fi

  ts_aligned=$((ts_aligned + pkg_aligned))
done

if [[ "$ts_aligned" -eq "${#PACKAGES[@]}" ]]; then
  ok "typescript $ts_range (resolved $ts_resolved) agrees across all ${#PACKAGES[@]} packages"
fi

# --- 3. Worker compatibility_date: pinned, valid, never in the future ---

# A future date does not fail the build; it silently adopts whatever runtime
# flags land between now and then, which is exactly the "drifts with the
# release" behaviour the pin is meant to prevent. UTF-8 zero-padded ISO dates
# compare correctly as strings.
today="$(date -u +%Y-%m-%d)"
for pkg in "${WORKERS[@]}"; do
  config="$pkg/wrangler.toml"
  date_value="$(sed -nE 's/^compatibility_date[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "$config" | head -1)"
  if [[ -z "$date_value" ]]; then
    fail "$config declares no compatibility_date — the Worker runtime version would move with the platform"
    continue
  fi
  if [[ ! "$date_value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    fail "$config compatibility_date \"$date_value\" is not an ISO date"
    continue
  fi
  if [[ "$date_value" > "$today" ]]; then
    fail "$config compatibility_date $date_value is in the future (today is $today) — flags would enable themselves as Cloudflare ships them"
    continue
  fi
  ok "$config pins compatibility_date $date_value"
done

if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "check-runtime-pins FAILED with $ERRORS error(s)."
  exit 1
fi

echo ""
echo "check-runtime-pins PASSED."
