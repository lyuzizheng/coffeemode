#!/usr/bin/env bash
# ==============================================================================
# CafeMood Basemap Monthly Build — OpenFreeMap MBTiles → PMTiles → R2
# Lifecycle:    docs/devops/LIFECYCLE.md
# Runbook:      docs/devops/maptiles-runbook.md (monthly cadence, rollback)
# Decision:     BRAWUKA-308 (no Planetiler — OFM publishes processed MBTiles),
#               BRAWUKA-313 (this task)
#
# Monthly cadence (coffee-shop OSM freshness is insensitive): fetch the pinned
# month's OpenFreeMap planet MBTiles, convert one step to PMTiles, upload to
# the per-env R2 bucket, and sync glyphs/sprites/styles. No bbox clipping —
# a clipped extract blanks out-of-area share links, and full-planet storage
# (~$1.2/mo) gives no reason to clip.
#
# Layout inside the bucket (see provision-maptiles.sh):
#   planet/{version}/planet.pmtiles   versioned archive (immutable, ~80GB)
#   planet/current.txt                live-version pointer (rewritten on promote)
#   fonts/... sprites/... styles/...  synced asset trees (immutable per file)
#
# Promotion is two-phase: upload everything first, then rewrite current.txt
# last — readers never see a half-written version. Rollback rewrites
# current.txt to the previous version (one object, seconds).
#
# Usage:
#   ./build-maptiles.sh --env staging --version 20260913_164504_pt
#   ./build-maptiles.sh --env staging --version latest --dry-run
#   ./build-maptiles.sh --env production --version latest
#
# Environment (same convention as scripts/devops/backup.sh):
#   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   R2 API token (PutObject on bucket)
#   R2_ACCOUNT_ID                             Cloudflare account id
#   R2_ENDPOINT                               Optional S3 endpoint override
#
# Tools (checked up front, installed by the operator, never vendored):
#   curl, sha256sum, pmtiles CLI (go-pmtiles), aws CLI
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV=""
VERSION="latest"
WORK_DIR=""
DRY_RUN=false

BUCKET_STAGING="cafemode-maptiles-staging"
BUCKET_PROD="cafemode-maptiles"
FILES_INDEX="https://btrfs.openfreemap.com/files.txt"
BTRFS_BASE="https://btrfs.openfreemap.com"
TILES_BASE="https://tiles.openfreemap.org"

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
    --version)
      VERSION="${2:?Error: --version requires a version (YYYYMMDD_HHMMSS_pt) or 'latest'}"
      shift 2
      ;;
    --work-dir)
      WORK_DIR="${2:?Error: --work-dir requires a path}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    staging|production)
      ENV="$1"
      shift
      ;;
    *)
      echo "Error: Unknown argument '$1'. Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "Error: --env <staging|production> is required." >&2
  exit 1
fi

# ------------------------------------------------------------------------------
# Logging Utilities
# ------------------------------------------------------------------------------
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${BOLD}${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${BOLD}${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${BOLD}${YELLOW}[WARN]${NC}  $*" >&2; }
error() { echo -e "${BOLD}${RED}[ERROR]${NC} $*" >&2; }

run_cmd() {
  if [[ "$DRY_RUN" == true ]]; then
    echo -e "  ${YELLOW}[DRY-RUN]${NC} $*"
  else
    "$@"
  fi
}

# ------------------------------------------------------------------------------
# Preconditions
# ------------------------------------------------------------------------------
for tool in curl sha256sum pmtiles aws; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    error "Required tool '$tool' not found. Install it first (see runbook §Build machine)."
    exit 1
  fi
done
if [[ -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" || -z "${R2_ACCOUNT_ID:-}" ]]; then
  if [[ "$DRY_RUN" != true ]]; then
    error "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID must be set (never commit them)."
    exit 1
  fi
fi

if [[ "$ENV" == "staging" ]]; then BUCKET="$BUCKET_STAGING"; else BUCKET="$BUCKET_PROD"; fi
ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID:-<account>}.r2.cloudflarestorage.com}"
AWS_ENV=(AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}")

if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d -t maptiles-build-XXXXXX)"
  trap 'rm -rf "$WORK_DIR"' EXIT
else
  mkdir -p "$WORK_DIR"
fi

# ------------------------------------------------------------------------------
# Step 1: resolve the version (latest = newest planet MBTiles in files.txt)
# ------------------------------------------------------------------------------
log "Step 1/7: resolving OpenFreeMap planet version..."
if [[ "$VERSION" == "latest" ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY-RUN: would fetch $FILES_INDEX and pick the newest areas/planet/*/tiles.mbtiles."
    VERSION="<latest>"
  else
    VERSION="$(curl -fsSL --max-time 60 "$FILES_INDEX" \
      | grep 'planet/.*mbtiles$' | tail -1 | cut -d/ -f3)"
    if [[ -z "$VERSION" ]]; then
      error "Could not resolve a planet version from $FILES_INDEX."
      exit 1
    fi
  fi
fi
log "Building version: $VERSION"
AREA_PATH="areas/planet/${VERSION}"

# ------------------------------------------------------------------------------
# Step 2: download tiles.mbtiles + SHA256SUMS, verify integrity
# ------------------------------------------------------------------------------
log "Step 2/7: downloading planet MBTiles (~80–100GB, resume-safe)..."
run_cmd curl -fSL --retry 3 --retry-all-errors -C - --max-time 86400 \
  -o "${WORK_DIR}/planet.mbtiles" "${BTRFS_BASE}/${AREA_PATH}/tiles.mbtiles"
if [[ "$DRY_RUN" != true ]]; then
  log "Verifying checksum against published SHA256SUMS..."
  curl -fsSL --max-time 60 -o "${WORK_DIR}/SHA256SUMS" "${BTRFS_BASE}/${AREA_PATH}/SHA256SUMS"
  (cd "$WORK_DIR" && sha256sum -c <(grep 'tiles.mbtiles' SHA256SUMS))
  ok "Checksum verified."
fi

# ------------------------------------------------------------------------------
# Step 3: convert MBTiles → PMTiles (single step, no Planetiler)
# ------------------------------------------------------------------------------
log "Step 3/7: converting MBTiles → PMTiles (pmtiles convert)..."
run_cmd pmtiles convert "${WORK_DIR}/planet.mbtiles" "${WORK_DIR}/planet.pmtiles"
if [[ "$DRY_RUN" != true ]]; then
  if ! head -c 7 "${WORK_DIR}/planet.pmtiles" | grep -q "PMTiles"; then
    error "Converted file is not a PMTiles archive (bad magic)."
    exit 1
  fi
  ok "PMTiles archive verified (magic OK, $(du -h "${WORK_DIR}/planet.pmtiles" | cut -f1))."
fi

# ------------------------------------------------------------------------------
# Step 4: upload the versioned archive (immutable key — safe to re-run)
# ------------------------------------------------------------------------------
log "Step 4/7: uploading planet/${VERSION}/planet.pmtiles to r2:${BUCKET}..."
run_cmd env "${AWS_ENV[@]}" aws s3 cp "${WORK_DIR}/planet.pmtiles" \
  "s3://${BUCKET}/planet/${VERSION}/planet.pmtiles" \
  --endpoint-url "$ENDPOINT" --content-type "application/octet-stream" \
  --metadata "ofm-version=${VERSION}"

# ------------------------------------------------------------------------------
# Step 5: sync fonts + sprites from the public instance (immutable per file)
# ------------------------------------------------------------------------------
log "Step 5/7: syncing glyphs + sprites (3 fontstacks × ranges, ofm_f384 set)..."
FONTSTACKS=("Noto%20Sans%20Regular" "Noto%20Sans%20Bold" "Noto%20Sans%20Italic")
if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN: would sync ~200 font ranges + 6 sprite files to r2:${BUCKET}."
else
  mkdir -p "${WORK_DIR}/fonts" "${WORK_DIR}/sprites"
  for stack in "${FONTSTACKS[@]}"; do
    decoded="$(printf '%b' "${stack//%/\\x}")"
    for start in $(seq 0 256 65280); do
      end=$((start + 255))
      range="${start}-${end}"
      dest="${WORK_DIR}/fonts/${decoded}/${range}.pbf"
      if [[ -f "$dest" ]]; then continue; fi
      mkdir -p "$(dirname "$dest")"
      code="$(curl -sS -o "$dest" -w "%{http_code}" --max-time 60 \
        "${TILES_BASE}/fonts/${stack}/${range}.pbf" || echo "000")"
      if [[ "$code" == "404" ]]; then
        rm -f "$dest"
        continue
      fi
      if [[ "$code" != "200" ]]; then
        error "Font fetch failed: ${stack}/${range} → HTTP $code."
        exit 1
      fi
    done
    ok "Fontstack synced: $decoded."
  done
  env "${AWS_ENV[@]}" aws s3 sync "${WORK_DIR}/fonts" "s3://${BUCKET}/fonts" \
    --endpoint-url "$ENDPOINT" --content-type "application/x-protobuf" --size-only
  for f in "ofm.json" "ofm@2x.json" "ofm.png" "ofm@2x.png"; do
    curl -fsSL --max-time 60 -o "${WORK_DIR}/sprites/${f}" \
      "${TILES_BASE}/sprites/ofm_f384/${f}"
  done
  for f in "ofm.json" "ofm@2x.json" "ofm.png" "ofm@2x.png"; do
    case "$f" in
      *.json) ctype="application/json" ;;
      *.png) ctype="image/png" ;;
    esac
    env "${AWS_ENV[@]}" aws s3 cp "${WORK_DIR}/sprites/${f}" \
      "s3://${BUCKET}/sprites/ofm_f384/${f}" \
      --endpoint-url "$ENDPOINT" --content-type "$ctype"
  done
  ok "Glyphs + sprites synced."
  # natural_earth raster (ne2sr, z0–6, used by the `natural_earth` style layer):
  # tiny static set (~2MB) — mirror once per build, immutable per file.
  mkdir -p "${WORK_DIR}/natural_earth"
  for z in 0 1 2 3 4 5 6; do
    max=$(( (1 << z) - 1 ))
    for x in $(seq 0 "$max"); do
      for y in $(seq 0 "$max"); do
        dest="${WORK_DIR}/natural_earth/ne2sr/${z}/${x}/${y}.png"
        if [[ -f "$dest" ]]; then continue; fi
        mkdir -p "$(dirname "$dest")"
        curl -fsSL --max-time 60 -o "$dest" "${TILES_BASE}/natural_earth/ne2sr/${z}/${x}/${y}.png"
      done
    done
  done
  env "${AWS_ENV[@]}" aws s3 sync "${WORK_DIR}/natural_earth" "s3://${BUCKET}/natural_earth" \
    --endpoint-url "$ENDPOINT" --content-type "image/png" --size-only
  ok "natural_earth raster synced."
fi

# ------------------------------------------------------------------------------
# Step 6: rewrite style JSONs against the self-hosted origin
# ------------------------------------------------------------------------------
log "Step 6/7: rewriting style JSONs (public origin → self-hosted origin)..."
SELF_ORIGIN="https://$([[ "$ENV" == "staging" ]] && echo "staging-tiles.cafemood.app" || echo "tiles.cafemood.app")"
if [[ "$DRY_RUN" == true ]]; then
  log "DRY-RUN: would rewrite 5 style JSONs with origin $SELF_ORIGIN and upload to r2:${BUCKET}/styles/."
else
  mkdir -p "${WORK_DIR}/styles"
  for style in positron bright liberty dark fiord; do
    curl -fsSL --max-time 60 -o "${WORK_DIR}/styles/${style}.json" "${TILES_BASE}/styles/${style}"
    python3 - "${WORK_DIR}/styles/${style}.json" "$SELF_ORIGIN" <<'EOF'
import json, sys
path, origin = sys.argv[1], sys.argv[2]
doc = json.load(open(path))
for src in doc.get("sources", {}).values():
    if isinstance(src, dict):
        if src.get("url") == "https://tiles.openfreemap.org/planet":
            src["url"] = f"{origin}/planet"
        for i, t in enumerate(src.get("tiles", []) or []):
            if "tiles.openfreemap.org" in t:
                src["tiles"][i] = t.replace("https://tiles.openfreemap.org", origin)
if isinstance(doc.get("glyphs"), str) and "tiles.openfreemap.org" in doc["glyphs"]:
    doc["glyphs"] = doc["glyphs"].replace("https://tiles.openfreemap.org", origin)
if isinstance(doc.get("sprite"), str) and "tiles.openfreemap.org" in doc["sprite"]:
    doc["sprite"] = doc["sprite"].replace("https://tiles.openfreemap.org", origin)
json.dump(doc, open(path, "w"), separators=(",", ":"))
print(f"rewrote {path}")
EOF
    env "${AWS_ENV[@]}" aws s3 cp "${WORK_DIR}/styles/${style}.json" \
      "s3://${BUCKET}/styles/${style}.json" \
      --endpoint-url "$ENDPOINT" --content-type "application/json"
  done
  ok "Styles rewritten + uploaded."
fi

# ------------------------------------------------------------------------------
# Step 7: promote — rewrite current.txt LAST (the only mutable pointer)
# ------------------------------------------------------------------------------
log "Step 7/7: promoting version (planet/current.txt → $VERSION)..."
if [[ "$DRY_RUN" == true ]]; then
  run_cmd env "${AWS_ENV[@]}" aws s3 cp "-" "s3://${BUCKET}/planet/current.txt" --endpoint-url "$ENDPOINT"
else
  printf '%s\n' "$VERSION" | env "${AWS_ENV[@]}" aws s3 cp - "s3://${BUCKET}/planet/current.txt" \
    --endpoint-url "$ENDPOINT" --content-type "text/plain"
fi
ok "Promoted planet/$VERSION as current."

echo ""
ok "Build complete: r2:${BUCKET}/planet/${VERSION}/planet.pmtiles (+ fonts/sprites/styles)."
echo "Next: verify with ./scripts/devops/verify-maptiles.sh --env $ENV --expect-version $VERSION"
