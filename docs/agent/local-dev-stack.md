# Local Dev Stack — Real Postgres + Local Workers (Compose Full Kit, S2)

How to run CafeMood's full chain locally without any Cloudflare/R2 credentials:
a real Postgres/PostGIS via Docker, MinIO as an R2 stand-in, both Workers
under `workerd`/`miniflare` via compose, and auth against the staging Supabase
project with real Google OAuth (spec 0010 §3). One `docker compose up -d --wait`
brings the whole kit; the compose `supabase-mock` stays as the offline-only
auth stand-in.

Why this exists: migrations 0001–0008 and the `checkin_likes` triggers were
previously validated by reasoning only (no live Postgres anywhere). The
integration suite in this doc exercises them against a real database.

## Prerequisites

- Docker (compose v2). macOS: OrbStack or Docker Desktop.
- Node 22+ (`web/`, `poi-service/`, `image-service/` each have their own
  `node_modules`).

## 1. Full kit via Compose (postgres + MinIO + D1/KV + Workers + Supabase mock)

```bash
docker compose up -d --wait        # brings postgres, minio, miniflare-poi, miniflare-image, supabase-mock
docker compose ps                  # all should be healthy/running
docker compose logs -f miniflare-poi miniflare-image supabase-mock  # tail worker + mock logs
```

`--wait` blocks until every service with a `healthcheck` is healthy (postgres,
minio, and both workers). The bucket is created by `minio-init` (one-shot,
`mc mb` + anonymous read); it re-runs safely via `docker compose run --rm minio-init`
if you ever wipe volumes.

| Service | Image / runtime | Defaults / bindings |
| --- | --- | --- |
| postgres | `postgis/postgis:16-3.4` | `postgres://coffeemode:coffeemode@localhost:5432/coffeemode` (superuser) |
| minio | `quay.io/minio/minio` | access key `coffeemode` / secret `coffeemode123`, S3 API on `localhost:9000`, console on `localhost:9001` |
| minio-init | `quay.io/minio/mc` | creates bucket `coffeemode` + anonymous read (mirrors a public R2 bucket) |
| miniflare-poi | `node:22-bookworm-slim` + `wrangler dev` (workerd/miniflare) | `http://localhost:8787` (host) / `http://miniflare-poi:8787` (compose network); D1 `poi-store` (`11111111-1111-…`) + KV `poi-cache` (`22222222-2222-…`) from `poi-service/wrangler.toml`; secrets via env `POI_SERVICE_TOKEN=local-dev-token`, `GOOGLE_PLACES_API_KEY=dummy` |
| miniflare-image | `node:22-bookworm-slim` + `wrangler dev` (workerd) | `http://localhost:8788` / `http://miniflare-image:8788`; R2 presigning → MinIO via `R2_ENDPOINT=http://minio:9000` (inside compose) and `R2_PUBLIC_URL=http://localhost:9000/coffeemode`; bucket `coffeemode`; secrets via `IMAGE_SERVICE_TOKEN=local-dev-token`, `R2_ACCESS_KEY_ID/SECRET` |
| supabase-mock | `node:22-alpine` + `scripts/supabase-mock.mjs` | `http://localhost:54321` (same host port as `supabase start`); offline-only auth stand-in (spec 0010 §3 — the default is the staging project, see §4); issues unsigned fake JWTs (single source `scripts/fake-jwt.mjs`); `POST /auth/v1/token` accepts any email |

**Auth default: staging, not the mock (spec 0010 §3).** Local manual development
authenticates against the STAGING Supabase project (`ojujmjewtbquiddswyrg`) with
real Google OAuth — `web/.env.example` already points `NEXT_PUBLIC_SUPABASE_URL`
there; fill `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the staging dashboard (publishable
key `sb_publishable_…`, public by design, never `service_role`). For offline work only, either the
compose mock or the real Supabase CLI emulator:

```bash
docker compose stop supabase-mock
supabase start   # local stack on :54321 (API), :54322 (DB), see `supabase status`)
# then set in web/.env.local:
#   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key from supabase status>
```

Both the mock and `supabase start` share `:54321`; only point the `NEXT_PUBLIC_*`
vars there when working offline. Tests never need a live Supabase —
`web/tests/helpers/auth.ts:fakeJwt` (+ `decodeFakeJwt`) runs fully in-process.

**Local Cloudflare script mocks.** Both workers run under `wrangler dev`
(which is `workerd` + `miniflare` under the hood) — no Cloudflare account
needed. D1/KV/R2 bindings are local: D1 lives in `.wrangler/state` inside the
named volume `poi-worker-state` (and `image-worker-state` for the image worker);
the bind mount `. :/workspace` is shadowed at `.wrangler` by the named volume, so
state is persisted across `docker compose` restarts via the volume, not as loose
files on the host. KV is in-memory via miniflare, and R2 is MinIO. The web app's
`web/.env.example` already points `POI_SERVICE_URL=http://localhost:8787` and
`IMAGE_SERVICE_URL=http://localhost:8788` at these compose services.

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
- Every spec under `web/tests/` is `RUN_INTEGRATION=1`-gated and self-skips
  without it — there is no unit suite (BRAWUKA-682); a bare `vitest run`
  collects the files and exits green without Docker.

## 3. Workers — compose-managed (and manual alternative)

**Compose-managed (default).** No manual `wrangler dev` needed — `docker compose
up -d --wait` already runs both workers. Their logs are:

```bash
docker compose logs -f miniflare-poi    # poi-service (D1/KV)
docker compose logs -f miniflare-image  # image-service (R2 → MinIO)
```

- `miniflare-poi` applies D1 migrations on startup (`wrangler d1 migrations apply
  poi-store --local` from `poi-service/migrations/0001_init.sql`) and then
  serves on `:8787`. Stored-POI search (`/poi/search`) works fully offline
  against local D1/KV. `/poi/resolve` hits Google Places — stub it by pointing
  `GOOGLE_PLACES_BASE_URL` at a local server, or use the `mockFetch` pattern
  from `poi-service/tests/`.
- `miniflare-image` serves on `:8788`. With `R2_ENDPOINT=http://minio:9000`
  both presigned PUTs (`aws4fetch` SigV4) and the complete-flow `HEAD` check go
  to MinIO. `R2_PUBLIC_URL=http://localhost:9000/coffeemode` (bucket is
  anonymously readable). sharp processing runs as plain Node in
  `web/lib/images/processor.ts` — the "VPS" side is the host.

**Manual `wrangler dev` (host, still supported).** If you prefer to run workers
on the host instead of compose, stop the compose workers and run them directly:

```bash
docker compose stop miniflare-poi miniflare-image

cd poi-service
# Secrets — create poi-service/.dev.vars (gitignored), dummy values fine:
#   POI_SERVICE_TOKEN=local-dev-token
#   GOOGLE_PLACES_API_KEY=dummy
wrangler d1 migrations apply poi-store --local   # apply migrations/0001_init.sql to local D1
wrangler dev --port 8787                         # http://localhost:8787

cd image-service
# Create .dev.vars (gitignored):
#   IMAGE_SERVICE_TOKEN=local-dev-token
#   R2_ACCESS_KEY_ID=coffeemode
#   R2_SECRET_ACCESS_KEY=coffeemode123
#   R2_BUCKET_NAME=coffeemode     # MUST match the compose bucket (minio-init)
#   R2_ENDPOINT=http://localhost:9000
#   R2_PUBLIC_URL=http://localhost:9000/coffeemode
wrangler dev --port 8788                         # http://localhost:8788
```

Both paths share the same `wrangler.toml` local bindings (`poi-service/wrangler.toml`
now uses deterministic local UUIDs `111…`/`222…` so manual and compose never
reject the placeholder ids; `image-service/wrangler.toml` defaults to the local
`coffeemode` bucket and MinIO endpoints).

## 4. Web app wiring

```bash
cd web
cp .env.example .env.local
# .env.example already points data + workers at the compose kit:
#   DATABASE_URL=postgres://coffeemode:coffeemode@localhost:5432/coffeemode
#   POI_SERVICE_URL=http://localhost:8787
#   POI_SERVICE_TOKEN=local-dev-token
#   IMAGE_SERVICE_URL=http://localhost:8788
#   IMAGE_SERVICE_TOKEN=local-dev-token
# Auth default is the STAGING Supabase project (spec 0010 §3):
#   NEXT_PUBLIC_SUPABASE_URL=https://ojujmjewtbquiddswyrg.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key (sb_publishable_…) from Dashboard → Settings → API>
# Offline-only override (mock or `supabase start` on :54321):
#   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
# For production, replace those with real Worker URLs + real Supabase project.
# Staging redirect allowlist: docs/agent/pending-user-actions.md §1a.
npm run dev
```

Auth: local manual flows use the staging project with real Google OAuth by default
(spec 0010 §3). Offline only: the compose `supabase-mock` issues fake JWTs
(`POST http://localhost:54321/auth/v1/token` with any email → `access_token`);
tests inject auth via `web/tests/helpers/auth.ts:fakeJwt` without hitting the
mock at all. For a real local Supabase, use `supabase start` as above.

## 5. What still needs real Cloudflare/Supabase

- Deploying either Worker — `npm run deploy -- --env <staging|production>` from
  `image-service/` or `poi-service/`; local dev needs no account, and the guarded
  entrypoint (`scripts/deploy.mjs`) refuses to ship the local-dev defaults above.
- **Web-side image display**: `web/lib/images/loader.ts` and `next.config.ts`
  hardcode the real CDN host and a build-time drift guard (`images.cafemood.app`),
  so a browser round-trip through the UI still resolves to production R2 —
  only the API/DB/image-service worker flow is local. Relaxing the drift guard
  for a local `R2_PUBLIC_URL` is a future, explicit opt-in.
- R2 lifecycle cleanup and any behavior specific to real R2 edge semantics.
- Google Places live resolution and OAuth provider round-trips (the mock's
  Google key is `dummy`; live search requires a real `GOOGLE_PLACES_API_KEY`).
