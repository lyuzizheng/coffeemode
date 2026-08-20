# poi-service — CoffeeMode POI cache microservice

Cloudflare Worker (Workers + D1 + KV) that is the **only** place in the app that
talks to Google Places. Every Google call is cached once for everyone; the API
key never reaches Next.js or the browser.

Spec: `docs/specs/0001-nextjs-migration.md` § "POI cache service".
Slice: `poi-cache-service` in `docs/agent/implementation-slices.md`.

## Endpoints (all require `x-poi-service-token` header)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/poi/:place_id` | Fetch/enrich one POI: KV hot → D1 fresh → Google API → backfill both |
| POST | `/poi/resolve` | `{maps_share_url}` → POI (cafe creation import path; follows short links) |
| GET | `/poi/search?q&lat&lng&r` | Search **stored** POIs: name match + haversine distance sort (r in km, default 10) |
| GET | `/poi/search/external?q&lat&lng&r` | Live Google Places search; usable results are written to D1/KV before returning |
| POST | `/poi/external` | Store externally-searched POIs: array in body or `{pois: [...]}` (Google live / Apple MapKit refs) |

## Local development

```bash
npm install
npm run typecheck        # tsc --noEmit
npm test                 # vitest (Google/D1/KV fully mocked)
npm run dev              # wrangler dev
```

Dev secrets go in `poi-service/.dev.vars` (gitignored):

```text
POI_SERVICE_TOKEN=...
GOOGLE_PLACES_API_KEY=...
```

## Data store

- **KV** — hot cache of raw Google Places responses, key `raw:google:<place_id>`, TTL ~7d.
- **D1** — durable normalized POI store (`pois` table). Schema in `migrations/0001_init.sql`.

```bash
# one-time, after the namespaces exist (owner actions — docs/agent/pending-user-actions.md §7)
wrangler d1 migrations apply poi-store --local
wrangler d1 migrations apply poi-store --remote
```

## Deploy checklist (owner)

1. Create resources: `wrangler d1 create poi-store` and `wrangler kv namespace create poi-cache`,
   then copy the returned ids into `wrangler.toml`.
2. Apply migrations (above).
3. `wrangler secret put POI_SERVICE_TOKEN` and `wrangler secret put GOOGLE_PLACES_API_KEY`.
4. `npm run deploy` — workers.dev URL works immediately; custom domain after the
   domain lands.

## Design notes

- Field masks on every Google call keep billing minimal; photos are stored as
  references (`photo.name`) and fetched lazily.
- Apple POIs have no server-side upstream — they are stored via `POST /poi/external`
  and served from D1 only.
- Graceful degradation: a stale D1 row is served if the Google refresh fails.
- Auth is a shared-secret constant-time compare; service-to-service only, never
  called from the browser.
