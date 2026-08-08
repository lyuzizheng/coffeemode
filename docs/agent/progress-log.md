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

## 2026-08-09

- Implemented Part A of the 0004 Phase 1 backlog on `feat/impl-design-tokens`:
  - Reconciled design tokens (`--secondary` sage, small radius scale, warm shadows) in `web/app/globals.css`.
  - Mounted `<Toast.Provider>` in `web/app/providers.tsx`.
  - Added `profile`, `create`, `checkIn`, `success`, and `search` i18n namespaces in `web/messages/en.json` and `web/messages/zh.json`.
  - Added `ScoreSlider`, `PolicyChips`, `CheckInSuccessCard`, `ProfileSection`, and `SearchFilter` prototypes in `web/app/theme-preview/sections/*`.
  - Wired new sections into `/theme-preview` and updated `preview-sections.tsx` barrel exports.
  - Synced `docs/specs/0002-design-system.md` with the actual `globals.css` token set.
- Ran an independent implementation review, fixed the reported nits, and opened PR #19.
- All gates green: `preflight.sh` and `cd web && npm run verify`.
- PR #19 merged to `main`.

## 2026-08-09 (continued)

- Implemented Part B of the 0004 Phase 1 backlog on `feat/impl-auth-middleware`:
  - Added `web/proxy.ts` (Next.js 16's renamed middleware convention) for Supabase SSR session refresh.
  - Added `web/db/migrations/0002_checkins_and_indexes.sql` with soft-delete columns, `checkin_likes` table, `likes_count`, image `source` field comments, and missing indexes.
  - Added `web/types/checkins.ts` (`CheckInScores`, `CheckInPolicy`, `CheckIn`, `CheckInInput`, `CheckInLike`) and `web/types/profile.ts` (`Profile`, `ProfileStats`, `ProfileWithStats`).
  - Extended `web/types/images.ts` with `StoredImageSource` on `StoredImage`.
  - Implemented `web/lib/stats/aggregate.ts` with recency-weighted per-user contributions, `experience_score`, `composite_score`, policy counts, social-weight hook, and incremental/full-recompute paths.
  - Added unit tests in `web/tests/stats/aggregate.test.ts` and `web/tests/proxy.test.ts`.
- Rebased onto `main` after Part A merged; resolved `web/repo_notes.md` by keeping both Part A and Part B notes.
- All gates green: `preflight.sh` and `cd web && npm run verify` (54 tests passed).

## 2026-08-09 (Part C)

- Implemented Part C of the 0004 Phase 1 backlog on `feat/impl-caching-perf-security`:
  - Added long immutable `Cache-Control` headers for `/_next/static/*`, `/icons/*`, and `/fonts/*` in `web/next.config.ts`.
  - Tuned Serwist runtime cache in `web/app/sw.ts`: `CacheFirst` 1-year for immutable build assets and icons/fonts, `NetworkOnly` for `/cafes/*`, `/profile`, `/api/*`, `/auth/*`, and the home page.
  - Added `buster: "v1"` to `web/lib/query/persist-options.ts` and a restore-error handler in `web/app/providers.tsx` that clears persisted state on cache corruption.
  - Added `MAX_UPLOAD_BYTES` (10 MB) to `image-service`, signed `Content-Length` when the client provides a size, and documented R2 lifecycle cleanup for abandoned `original/` objects.
  - Added `web/lib/places/validate-maps-url.ts` and applied host validation in `web/app/api/places/resolve/route.ts` before proxying.
  - Capped nearby search radius at 10 km in `web/lib/places/constants.ts` and `web/app/api/places/search/route.ts`.
  - Implemented an in-memory token-bucket `RateLimiter` in `web/lib/rate-limit.ts` and applied per-user/per-IP caps to `POST /api/images/upload`, `POST /api/images/complete`, `GET /api/places/search`, and `POST /api/places/resolve`.
  - Added/updated tests in `web/tests/rate-limit.test.ts`, `web/tests/places.test.ts`, `web/tests/query/persist-options.test.ts`, `web/tests/images/image-service-client.test.ts`, and `image-service/tests/handlers.test.ts`.
- Independent review fixes: isolated test `fetch` stubs, reset `rateLimiter` before every test, and propagated `ImageServiceError` status through `/api/images/complete`.
- All gates green: `preflight.sh`, `cd web && npm run verify` (73 tests), and `cd image-service && npm run typecheck && npm test` (14 tests).

## 2026-08-10

- Reviewed the codebase after merging Part C and identified the remaining Phase 1 backlog items that are not blocked by owner credentials or the Apple Developer Program:
  - D1: Tune Postgres pool config and error handling (`web/lib/db/postgres.ts`).
  - D4: Fix Worker wrangler placeholders and add deploy docs (`image-service/wrangler.toml`, `poi-service/wrangler.toml`, `docs/agent/pending-user-actions.md`).
  - D7: Add `checkin_likes` atomic toggle helper and `likes_count` sync (`web/lib/db/checkins.ts`).
  - A2: Harden sign-in/sign-out UX with loading/error states (`web/app/page.tsx`).
- Recommended next focus: D1 (Postgres pool tuning) — foundational for stability, no external credentials required, and a prerequisite for safer database usage when building cafe/check-in APIs.
- Updated `docs/agent/current-state.md` and `docs/agent/progress-log.md` to reflect Part C merged and D1 as the active focus.

## 2026-08-08

- Merged `feat/code-quality-cleanup` (PR #16): centralized constants, shared helpers, and split `theme-preview/preview-sections.tsx`.
- Ran a four-way subagent review covering frontend/UX design, check-in & social semantics, cafe creation & discovery scenarios, and auth/cache/performance/database/deploy.
- Drafted `docs/specs/0004-product-decisions-and-backlog.md` with proposed decisions, a phased implementation backlog, and open questions for owner confirmation.
