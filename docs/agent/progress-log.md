# Progress Log

## 2026-07-31

- Established documentation system: `docs/`, `docs/specs/`, `docs/adr/`, `docs/agent/`
- Created specs: 0001 (Next.js migration), 0002 (design system), 0003 (testing/CI)
- Created agent harness: `.agents/`, `AGENTS.md`
- Created implementation slices manifest
- Created CI workflows: application.yml, docs-harness.yml

## 2026-08-06

- Implemented `poi-cache-service` slice on `feat/poi-cache-service`:
  - Worker scaffold (wrangler.toml, tsconfig, vitest) in `poi-service/`
  - 4 endpoints + shared-secret auth (`src/handlers.ts`)
  - KV hot cache (7d TTL) + D1 normalized store + migrations (`src/store.ts`)
  - Google Places (New) client with field masks (`src/google.ts`)
  - Maps share-URL parser incl. short-link redirects (`src/url.ts`)
  - 44 unit tests, mocked D1/KV/fetch — all green, typecheck clean
  - CI workflow `poi-service.yml` (typecheck + unit)
  - Slice status READY → IN-PROGRESS; docs/specs/0001 structure updated
- Wrote `docs/agent/pending-user-actions.md` (owner-only setup checklist)

## 2026-08-06 (afternoon)

- PR #11 merged (poi-cache-service → COMPLETE). Devin review fixes verified:
  text-search field mask (`places.*` prefix), cache-write resilience, duplicate
  fields param, short-link host list — all correct; self-test harness fix included.
- Started `places-proxy` slice (PR #12): `web/lib/places/poi-client.ts` (server-only
  client, token header, no-store, 503 when unconfigured), `web/app/api/places/search`
  + `resolve` route handlers, `web/types/places.ts`, 15 new tests (mocked worker).
- PR #12 merged; Devin review fixes verified (path encoding for `0x…:0x…` ids,
  Headers-instance merge, safe error messages, 5s `AbortSignal` timeout).
  `places-proxy` → COMPLETE. All code side through the POI stack is done;
  remaining work is owner credential/account actions (`pending-user-actions.md`).

## 2026-08-07

- Updated `auth-foundation` to own the Postgres driver:
  - Migrated `web/lib/db` from `@neondatabase/serverless` to the standard `pg` Pool
    (`web/lib/db/postgres.ts`, `web/tests/postgres.test.ts`)
- Implemented `image-pipeline` slice (completes ADR-0002):
  - Relies on `auth-foundation` Postgres helpers (`web/lib/db/postgres.ts`)
  - Created `image-service/` Cloudflare Worker (`wrangler.toml`, `tsconfig`, vitest)
    with `POST /v1/images/upload` and `POST /v1/images/complete` endpoints that
    sign presigned R2 PUT/GET URLs using `aws4fetch` and verify `IMAGE_SERVICE_TOKEN`
  - Implemented `web/lib/images/image-service-client.ts` and `processor.ts` (`sharp`)
    to cap original at 4096px, generate card (400x300) and thumbnail (200x200),
    then PUT all three variants to R2
  - Added Next.js route handlers `web/app/api/images/upload/route.ts` and
    `web/app/api/images/complete/route.ts` that verify Supabase sessions and update
    `cafes.gallery` / `checkins.photos` JSONB
  - Updated `docs/adr/0002-postgres-image-service.md`, `docs/specs/0001-nextjs-migration.md`,
    `docs/agent/current-state.md`, `docs/agent/implementation-slices.md`,
    `docs/agent/progress-log.md`, `web/.env.example`, `web/README.md`, and the
    data-layer references in `.agents/skills/*`
  - All gates green: `preflight.sh`, `npm run verify` in `web/`, and
    `npm run typecheck` + `npm test` in `image-service/`
