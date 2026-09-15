#!/usr/bin/env bash
# ==============================================================================
# CafeMood Maptiles Self-Host Provisioning — R2 Buckets + Custom Domains
# Architecture: docs/specs/0005-dokploy-vps-and-deployment-architecture.md
# Lifecycle:    docs/devops/LIFECYCLE.md
# Decision:     BRAWUKA-308 (MapLibre GL + OpenFreeMap), BRAWUKA-313 (this task)
#
# Creates the dual-stack R2 buckets that serve the self-hosted basemap and
# prints the exact `web/config/app.yaml` `map:` values to switch hosting
# (BRAWUKA-311 consumes them — switching hosting is a config edit, never a
# code change).
#
# Buckets (dual-stack isolation, same convention as the image buckets):
#   staging:    cafemode-maptiles-staging  (served at staging-tiles.cafemood.app)
#   production: cafemode-maptiles          (served at tiles.cafemood.app)
#
# Layout inside each bucket (written by build-maptiles.sh; the Worker pins
# the live version via PLANET_VERSION — current.txt is informational only):
#   planet/{version}/planet.pmtiles   versioned planet archive (immutable)
#   planet/current.txt                informational version pointer
#   fonts/{fontstack}/{range}.pbf     Noto Sans glyph ranges (immutable)
#   sprites/ofm_f384/ofm{,@2x}.{json,png}  sprite set (immutable)
#   styles/{positron,bright,liberty,dark,fiord}.json  rewritten style docs
#
# Usage:
#   ./provision-maptiles.sh --env staging
#   ./provision-maptiles.sh --env production
#   ./provision-maptiles.sh --env staging --print-config   # app.yaml map: block
#   ./provision-maptiles.sh --dry-run
#
# Environment (S3-compatible R2 API, same convention as scripts/devops/backup.sh):
#   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   R2 API token (List/Create buckets)
#   R2_ACCOUNT_ID                             Cloudflare account id
#   R2_ENDPOINT                               Optional S3 endpoint override
#                                             (default: https://<account>.r2.cloudflarestorage.com)
# Worker-Route attach + CORS stay owner-side dashboard steps (each prints as
# a pending action): the API token that creates buckets cannot attach zones.
# (Bucket CORS itself is vestigial — the Worker serves all bytes with its own
# per-origin CORS; the rules apply only to direct bucket access.)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV=""
PRINT_CONFIG=false
DRY_RUN=false

BUCKET_STAGING="cafemode-maptiles-staging"
BUCKET_PROD="cafemode-maptiles"
DOMAIN_STAGING="staging-tiles.cafemood.app"
DOMAIN_PROD="tiles.cafemood.app"

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
    --print-config)
      PRINT_CONFIG=true
      shift
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

# ------------------------------------------------------------------------------
# Resolve per-env bucket + domain
# ------------------------------------------------------------------------------
if [[ "$ENV" == "staging" ]]; then
  BUCKET="$BUCKET_STAGING"
  DOMAIN="$DOMAIN_STAGING"
else
  BUCKET="$BUCKET_PROD"
  DOMAIN="$DOMAIN_PROD"
fi

print_config() {
  cat <<EOF
# BRAWUKA-313 self-hosted basemap ($ENV, bucket: $BUCKET). Paste under
# web/config/app.yaml map block — this is the whole hosting switch.
# (Four URLs only — the TileJSON URL is derived from tileStyle at runtime,
# so there is deliberately no tileJsonUrl key.)
map:
  tileStyle:
    light: https://$DOMAIN/styles/liberty.json
    dark: https://$DOMAIN/styles/dark.json
  glyphs: https://$DOMAIN/fonts/{fontstack}/{range}.pbf
  sprite: https://$DOMAIN/sprites/ofm_f384/ofm
EOF
}

if [[ "$PRINT_CONFIG" == true ]]; then
  print_config
  exit 0
fi

run_cmd() {
  if [[ "$DRY_RUN" == true ]]; then
    echo -e "  ${YELLOW}[DRY-RUN]${NC} $*"
  else
    "$@"
  fi
}

# ------------------------------------------------------------------------------
# Preconditions: aws CLI + credentials (same convention as backup.sh)
# ------------------------------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  error "aws CLI not found — install it to manage R2 buckets (backup.sh uses the same tool)."
  exit 1
fi
if [[ -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" || -z "${R2_ACCOUNT_ID:-}" ]]; then
  error "R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID must be set (never commit them)."
  exit 1
fi
ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
AWS_ENV=(AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}")

# ------------------------------------------------------------------------------
# Step 1: create the bucket (idempotent — head first, create on 404)
# ------------------------------------------------------------------------------
log "Step 1/3: ensuring R2 bucket '$BUCKET' exists ($ENV)..."
if [[ "$DRY_RUN" == true ]]; then
  run_cmd env "${AWS_ENV[@]}" aws s3api head-bucket --bucket "$BUCKET" --endpoint-url "$ENDPOINT"
  run_cmd env "${AWS_ENV[@]}" aws s3api create-bucket --bucket "$BUCKET" --endpoint-url "$ENDPOINT"
else
  if env "${AWS_ENV[@]}" aws s3api head-bucket --bucket "$BUCKET" --endpoint-url "$ENDPOINT" 2>/dev/null; then
    ok "Bucket '$BUCKET' already exists."
  else
    env "${AWS_ENV[@]}" aws s3api create-bucket --bucket "$BUCKET" --endpoint-url "$ENDPOINT"
    ok "Bucket '$BUCKET' created."
  fi
fi

# ------------------------------------------------------------------------------
# Step 2: vestigial bucket CORS (kept, harmless). The bucket is never
# browser-facing — the Worker serves all tile/asset bytes with its own
# per-origin CORS — so these rules take effect only on direct bucket access
# (operator debugging, never the map surface).
# ------------------------------------------------------------------------------
log "Step 2/3: applying vestigial bucket CORS (direct-access fallback only)..."
CORS_JSON="$(mktemp)"
trap 'rm -f "$CORS_JSON"' EXIT
cat > "$CORS_JSON" <<'EOF'
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://cafemood.app", "https://www.cafemood.app", "https://staging.cafemood.app", "http://localhost:3000"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["Range"],
      "ExposeHeaders": ["Content-Range", "Accept-Ranges", "Content-Length"],
      "MaxAgeSeconds": 86400
    }
  ]
}
EOF
run_cmd env "${AWS_ENV[@]}" aws s3api put-bucket-cors --bucket "$BUCKET" \
  --cors-configuration "file://${CORS_JSON}" --endpoint-url "$ENDPOINT"
ok "CORS applied."
log "Step 3/3: owner-side dashboard steps (not automatable with this token):"
echo "  1. Cloudflare dashboard → Workers & Pages → tiles-service-$ENV → Settings →"
echo "     Domains & Routes → Add Custom Domain: '$DOMAIN' (requires the cafemood.app"
echo "     zone, BRAWUKA-238). The WORKER owns this hostname via its Worker Route"
echo "     (see tiles-service/wrangler.toml) — do NOT attach it as an R2 custom"
echo "     domain, which would bypass the Worker and 404 every tile."
echo "  2. Cloudflare dashboard → R2 → bucket '$BUCKET' → Settings → Cache:"
echo "     enable Tiered Cache / Cache Rules for tile + asset responses."
echo "  3. Run the monthly build to fill the bucket:"
echo "       ./scripts/devops/build-maptiles.sh --env $ENV --version <YYYYMMDD_HHMMSS_pt>"
echo "     then paste the output of '$0 --env $ENV --print-config' into web/config/app.yaml."

echo ""
ok "Provisioning plan complete for '$BUCKET' ($ENV)."
print_config
