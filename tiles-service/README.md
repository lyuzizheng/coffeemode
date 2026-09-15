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
`PLANET_VERSION` var) and the hostname (`tiles.cafemood.app` /
`staging-tiles.cafemood.app`) via a Worker Route — never an R2 custom
domain, which would bypass the Worker and 404 every tile. It range-reads
tile bytes out of the archive via the `pmtiles` library (the official
Protomaps Cloudflare pattern; R2 egress is $0 and Worker-bound range reads
bill Class B ops, not bandwidth), mints the TileJSON, rewrites style
documents, and serves small static assets (fonts/sprites/raster) as object
bytes.

## Routes

| Route | Behavior |
| --- | --- |
| `GET /health` | `{"ok":true}`, no bucket touch |
| `GET /planet` | TileJSON (live version, archive-derived, edge-cached) |
| `GET /planet/{z}/{x}/{y}.pbf` | Tile BYTES range-read from the live archive (`application/x-protobuf`) |
| `GET /planet/{version}/{z}/{x}/{y}.pbf` | Tile BYTES range-read (pinned, share-link stability) |
| `GET /styles/<name>.json` | Rewritten style from R2 (no public-origin leakage) |
| `GET /fonts/...`, `/sprites/...`, `/natural_earth/...` | Asset bytes from R2 (immutable, long cache) |

Zoom is clamped to the archive header; unknown versions/styles/assets are 404 JSON.

## Deploy checklist

1. `scripts/devops/provision-maptiles.sh --env staging|production` (bucket + CORS).
2. Workers & Pages → tiles-service-`$ENV` → Domains & Routes → Add Custom Domain (`staging-tiles.cafemood.app` / `tiles.cafemood.app`, owner dashboard step, requires the cafemood.app zone).
3. Pin `PLANET_VERSION` per env in `wrangler.toml` (+ redeploy — the TileJSON embeds it).
4. `scripts/devops/build-maptiles.sh --env ... --version ...` then
   `scripts/devops/verify-maptiles.sh --env ...`.
5. `npm run deploy -- --env staging|production` (guarded — refuses the
   `cafemode-maptiles-local` placeholder; `--check` validates only).
