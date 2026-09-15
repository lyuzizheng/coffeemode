# Basemap Monthly Update Runbook — PMTiles + R2 Self-Host (BRAWUKA-313)

Decision: BRAWUKA-308 (MapLibre GL + OpenFreeMap; no Planetiler — OFM
publishes processed planet MBTiles weekly). This runbook owns the monthly
planet refresh, the public ↔ self-hosted switch, and the rollback path.

## What lives where

| Piece | Location |
| --- | --- |
| Buckets (`cafemode-maptiles`, `cafemode-maptiles-staging`) | `scripts/devops/provision-maptiles.sh` |
| Monthly build (MBTiles → PMTiles → R2 + fonts/sprites/styles) | `scripts/devops/build-maptiles.sh` |
| Pre-switch verification (TileJSON/style/glyph/equivalence/latency) | `scripts/devops/verify-maptiles.sh` |
| Thin serving Worker (TileJSON/tiles/styles/assets from R2 byte ranges) | `tiles-service/` |
| Hosting switch (the ONLY web coupling point) | `web/config/app.yaml` `map:` + `web/lib/config-schema/map.ts` |

Bucket layout (immutable versioned archives; the Worker pins the live version
via `PLANET_VERSION` — `current.txt` is an informational pointer only):

```text
planet/{version}/planet.pmtiles   ~80GB versioned archive (immutable)
planet/current.txt                informational version pointer (see above)
fonts/{fontstack}/{range}.pbf     Noto Sans glyph ranges (immutable per file)
natural_earth/ne2sr/{z}/{x}/{y}.png  shaded-relief raster, z0-6 only (~2MB, immutable per file)
sprites/ofm_f384/ofm{,@2x}.{json,png}
styles/{positron,bright,liberty,dark,fiord}.json  self-host-rewritten
```

## Monthly update (first week of the month, ~30 min operator time)

Staging first, production after staging verifies green:

```bash
# 0. Pick the version (newest planet MBTiles; --version latest resolves it)
VER=20260913_164504_pt   # or: --version latest

# 1. Build staging (download ~80–100GB → pmtiles convert → upload → promote)
./scripts/devops/build-maptiles.sh --env staging --version "$VER"

# 2. Verify staging BEFORE touching production
./scripts/devops/verify-maptiles.sh --env staging --expect-version "$VER"

# 3. Pin the staging Worker to the new version + deploy (one deploy — the
# `wrangler secret put` below is the old flow, kept for reference; prefer the
# vars edit so the version is reviewable in git)
#    edit tiles-service/wrangler.toml [env.staging].vars.PLANET_VERSION = "$VER"
(cd tiles-service && npm run deploy -- --env staging)

# 4. Repeat for production, then switch app.yaml (paste from --print-config)
./scripts/devops/build-maptiles.sh --env production --version "$VER"
./scripts/devops/verify-maptiles.sh --env production --expect-version "$VER"
#    edit tiles-service/wrangler.toml [env.production].vars.PLANET_VERSION = "$VER"
(cd tiles-service && npm run deploy -- --env production)
./scripts/devops/provision-maptiles.sh --env production --print-config
```

Build-machine requirements: ~250GB scratch disk (MBTiles + PMTiles side by
side during convert), no big RAM (Planetiler is NOT needed — `pmtiles
convert` is a single-step repackage). A plain VPS or local machine works;
`curl -C -` resumes an interrupted download, and re-running the script is
safe (versioned keys are immutable; the Worker only serves the pinned
`PLANET_VERSION`, so a half-uploaded version is never live).

## The hosting switch (public ↔ self-hosted = one config edit)

```yaml
# Public instance (today):
map:
  tileStyle:
    light: https://tiles.openfreemap.org/styles/liberty
    dark: https://tiles.openfreemap.org/styles/dark
  glyphs: https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf
  sprite: https://tiles.openfreemap.org/sprites/ofm_f384/ofm

# Self-hosted (after verify-maptiles passes — paste exact values from
# provision-maptiles.sh --env <env> --print-config):
map:
  tileStyle:
    light: https://tiles.cafemood.app/styles/liberty.json
    dark: https://tiles.cafemood.app/styles/dark.json
  glyphs: https://tiles.cafemood.app/fonts/{fontstack}/{range}.pbf
  sprite: https://tiles.cafemood.app/sprites/ofm_f384/ofm
```

Bad values fail fast at startup (`web/lib/config-schema/map.ts` — https-only,
non-empty style URLs); the map surface (BRAWUKA-311) degrades to an error
state with the discovery sheet still usable.

## Rollback

| Failure | Rollback (seconds–minutes, no rebuild) |
| --- | --- |
| New planet version renders badly | Revert `[env.*].vars.PLANET_VERSION` to the previous version + redeploy the Worker (old archive is immutable and still in the bucket; `planet/current.txt` is informational only) |
| Self-hosted origin unhealthy | Revert the four `map:` URLs to the public instance (one config edit, redeploy web) |
| Broken style rewrite | Re-upload the previous month's `styles/*.json` (kept in the build work-dir) or revert to public style URLs |

## Costs (monthly, measured 2026-09)

- R2 storage ~80GB × $0.015 = **~$1.2/mo**; Class B range reads $0.36/M; egress $0. Total well under $2/mo.
- No bbox clipping: a clipped extract blanks out-of-area share links, and full-planet storage gives no reason to clip.
- Fallback if R2 range latency ever misses budget: OFM official Btrfs+nginx self-host (Hetzner ~€40/mo) — a separate ops surface, not this pipeline.

## Baselines (2026-09-15, Singapore → public instance, cold → warm)

Public-instance range latency (20 samples each, `verify-maptiles.sh`):

| Endpoint | median | p95 | n |
| --- | --- | --- | --- |
| vector tile z10 (39KB) | 60ms | 81ms | 20/20 |
| glyph range 0–255 (77KB) | — | ~105ms max of 12 | 12/12 |
| style JSON (liberty) | — | ~54ms max of 5 | 5/5 |

Self-hosted acceptance: `verify-maptiles.sh --env <env>` green, including
p95 ≤ 1500ms and byte-equivalence of a sample tile against the public
instance (same planet version). Re-baseline on the self-hosted origin after
first promote and paste the numbers here.
