# CafeMood Tiles Service

Self-hosted basemap Worker + R2 (BRAWUKA-313). Serves the TileJSON, style,
glyph, sprite, and tile URL space the web map surface (BRAWUKA-311) reads
from `web/config/app.yaml` `map:` — over the per-env R2 bucket filled by
`scripts/devops/build-maptiles.sh`.

## Why a Worker (not R2-direct)

R2 custom domains serve objects but cannot mint the stable URL space: the
bucket holds ONE versioned archive per build
(`planet/{version}/planet.pmtiles`, immutable) while the map surface needs
unversioned URLs (`/planet`, `/planet/{z}/{x}/{y}.pbf`) that survive monthly
promotes. The Worker owns that mapping (live version from the
`PLANET_VERSION` secret), mints the TileJSON, rewrites style documents, and
302-redirects tiles/assets to the R2 object URLs — it never proxies tile
bytes, so it pays no bandwidth for them.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /health` | `{"ok":true}`, no bucket touch |
| `GET /planet` | TileJSON (live version, `maxzoom 14`) |
| `GET /planet/{z}/{x}/{y}.pbf` | 302 → versioned PBF URL (live version) + `?v=<etag>` fingerprint |
| `GET /planet/{version}/{z}/{x}/{y}.pbf` | 302 → versioned PBF URL (pinned, share-link stability) |
| `GET /styles/<name>.json` | Rewritten style from R2 (no public-origin leakage) |
| `GET /fonts/...`, `/sprites/...` | 302 → R2 object URL (immutable, long cache) |

Zoom is clamped to 0–14; unknown versions/styles/assets are 404 JSON.

## Deploy checklist

1. `scripts/devops/provision-maptiles.sh --env staging|production` (bucket + CORS).
2. Attach the custom domain (`staging-tiles.cafemood.app` / `tiles.cafemood.app`, owner dashboard step).
3. `wrangler secret put PLANET_VERSION --env staging|production`.
4. `scripts/devops/build-maptiles.sh --env ... --version ...` then
   `scripts/devops/verify-maptiles.sh --env ...`.
5. `npm run deploy -- --env staging|production` (guarded — refuses the
   `cafemode-maptiles-local` placeholder; `--check` validates only).
