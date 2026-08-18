# Local Dev Stack — Real Postgres + Local Workers

How to run CoffeeMode's full chain locally without any Cloudflare/R2/Supabase
credentials: a real Postgres/PostGIS via Docker, MinIO as an R2 stand-in, and
both Workers under `wrangler dev` (workerd).

Why this exists: migrations 0001–0008 and the `checkin_likes` triggers were
previously validated by reasoning only (no live Postgres anywhere). The
integration suite in this doc exercises them against a real database.

## Prerequisites

- Docker (compose v2). macOS: OrbStack or Docker Desktop.
- Node 22+ (`web/`, `poi-service/`, `image-service/` each have their own
  `node_modules`).

## 1. Postgres + MinIO (one command)

```bash
docker compose up -d --wait postgres minio  # wait for Postgres + MinIO health
docker compose run --rm minio-init          # create the local bucket after MinIO is ready
```

| Service | Image | Defaults |
| --- | --- | --- |
| postgres | `postgis/postgis:16-3.4` | `postgres://coffeemode:coffeemode@localhost:5432/coffeemode` (superuser) |
| minio | `minio/minio` | access key `coffeemode` / secret `coffeemode123`, S3 API on `:9000`, console on `:9001` |
| minio-init | `minio/mc` | creates bucket `coffeemode` + anonymous read (mirrors a public R2 bucket) |

## 2. Migrations + integration tests

```bash
cd web
npm run db:migrate            # applies web/db/migrations/*.sql 0001→0008 in order
npm run test:integration      # = RUN_INTEGRATION=1 vitest run tests/integration
```

- `test:integration` requires a local Postgres host by default and provisions a
  per-run throwaway database (`coffeemode_test_<pid>_<random>`), applies every
  migration through the same runner, and verifies on real SQL:
  all 8 migrations + PostGIS + both `checkin_likes` triggers; the like toggle
  (like/unlike/self-like 403/legacy un-like); the 0008 no-self trigger on
  direct inserts; the 0004 sync trigger on direct and profile-cascade writes; the
  fused cafe+first-check-in transaction with `work_stats`, stored photo/gallery
  state, and consumed upload intent; `recordNavigation` and stored navigation state.
- The test DB is dropped afterwards; cleanup failures fail the run. Set
  `ALLOW_REMOTE_INTEGRATION_DB=1` only for an explicitly disposable test server.
- Plain `npm test` (unit suite) skips the integration file automatically —
  machines without Docker stay green.

## 3. Workers locally (`wrangler dev`)

Both workers run on the host via workerd; no Cloudflare account needed.

### poi-service (Google POI cache: KV + D1)

```bash
cd poi-service
# Secrets — create poi-service/.dev.vars (gitignored), dummy values fine:
#   POI_SERVICE_TOKEN=local-dev-token
#   GOOGLE_PLACES_API_KEY=dummy
wrangler d1 migrations apply poi-store --local   # apply migrations/0001_init.sql to local D1
wrangler dev --port 8787                         # http://localhost:8787
```

> Validation note: §3's worker commands follow the existing
> `poi-service/README.md` local-dev pattern but were NOT executed on this
> machine (local-mode tolerance of placeholder D1/KV ids in `wrangler.toml`
> is wrangler-version-dependent). If `wrangler dev` rejects the placeholder
> ids, run `wrangler d1 create poi-store` / `wrangler kv namespace create
> poi-cache` and paste the returned ids.

Stored-POI search (`/poi/search`) works fully offline against local D1/KV.
`/poi/resolve` hits Google Places — stub it by pointing the Google fetch at a
local server, or use the `mockFetch` pattern from `poi-service/tests/`.

### image-service (presigned R2 URLs: MinIO + sharp on the host)

```bash
cd image-service
# Create .dev.vars (gitignored):
#   IMAGE_SERVICE_TOKEN=local-dev-token
#   R2_ACCESS_KEY_ID=coffeemode
#   R2_SECRET_ACCESS_KEY=coffeemode123
#   R2_BUCKET_NAME=coffeemode     # MUST match the compose bucket (minio-init)
#   R2_ENDPOINT=http://localhost:9000
#   R2_PUBLIC_URL=http://localhost:9000/coffeemode
# (R2_ENDPOINT overrides the hardcoded *.r2.cloudflarestorage.com endpoint —
#  see src/r2.ts; without R2_BUCKET_NAME set here, presigns would target the
#  wrangler.toml placeholder bucket and MinIO would answer NoSuchBucket.
#  R2_PUBLIC_URL is only consumed by worker-returned publicUrls; browser-side
#  display still resolves to the real CDN host — see §5.)
wrangler dev --port 8788                         # http://localhost:8788
```

With `R2_ENDPOINT` set, both presigned PUTs (`aws4fetch` SigV4) and the
complete-flow `HEAD` check go to MinIO. `R2_PUBLIC_URL` for local dev:
`http://localhost:9000/coffeemode` (bucket is anonymously readable).
sharp processing runs as plain Node in `web/lib/images/processor.ts` — the
"VPS" side is the host.

## 4. Web app wiring

```bash
cd web
cp .env.example .env.local
# Point the DB at the compose Postgres; leave Supabase vars as-is if you only
# exercise DB-backed flows (auth-less code paths return 401 by design).
#   DATABASE_URL=postgres://coffeemode:coffeemode@localhost:5432/coffeemode
#   POI_SERVICE_URL=http://localhost:8787
#   POI_SERVICE_TOKEN=local-dev-token
#   IMAGE_SERVICE_URL=http://localhost:8788
#   IMAGE_SERVICE_TOKEN=local-dev-token
#   RATE_LIMIT_BACKEND=postgres   # or memory for single-process dev
npm run dev
```

Supabase OAuth is the one remote dependency that cannot be fully faked
without Supabase CLI (`supabase start` local emulator); for DB-flow testing,
lib functions accept `userId` directly and integration tests inject it.

## 5. What still needs real Cloudflare/Supabase

- Deploying either Worker (`wrangler deploy`) — local dev needs no account.
- **Web-side image display**: `web/lib/images/loader.ts` and `next.config.ts`
  hardcode the real CDN host and a build-time drift guard (`images.coffeemode.app`),
  so a browser round-trip through the UI still resolves to production R2 —
  only the API/DB/image-service worker flow is local. Relaxing the drift guard
  for a local `R2_PUBLIC_URL` is a future, explicit opt-in.
- R2 lifecycle cleanup and any behavior specific to real R2 edge semantics.
- Google Places live resolution and OAuth provider round-trips.
