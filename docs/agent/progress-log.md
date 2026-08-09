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

## 2026-08-08

- Merged `feat/code-quality-cleanup` (PR #16): centralized constants, shared helpers, and split `theme-preview/preview-sections.tsx`.
- Ran a four-way subagent review covering frontend/UX design, check-in & social semantics, cafe creation & discovery scenarios, and auth/cache/performance/database/deploy.
- Drafted `docs/specs/0004-product-decisions-and-backlog.md` with proposed decisions, a phased implementation backlog, and open questions for owner confirmation.

## 2026-08-09 (evening)

- Pushed `docs/issue-management` (PR #52): established the issue-management
  system (GitHub issues are the intake for fixes):
  - `docs/agent/issue-guidelines.md` — categories, priorities, template,
    deferral policy, PR conventions
  - Repo skills `coffeemode-issue-submission` and `coffeemode-issue-review-fix`
  - `AGENTS.md` "Issue workflow" section + `ROUTER.md` intent rows
  - Slices registered for issues #23–#27 inside `docs/agent/implementation-slices.md`
    (`issue-23-rate-limit-backend`, `issue-24-likes-trigger`,
    `issue-25-complete-service`, `issue-26-shared-common`,
    `issue-27-stats-locking`)

## 2026-08-10

- Reviewed the codebase after merging Part C and identified the remaining Phase 1 backlog items that are not blocked by owner credentials or the Apple Developer Program:
  - D1: Tune Postgres pool config and error handling (`web/lib/db/postgres.ts`).
  - D4: Fix Worker wrangler placeholders and add deploy docs (`image-service/wrangler.toml`, `poi-service/wrangler.toml`, `docs/agent/pending-user-actions.md`).
  - D7: Add `checkin_likes` atomic toggle helper and `likes_count` sync (`web/lib/db/checkins.ts`).
  - A2: Harden sign-in/sign-out UX with loading/error states (`web/app/page.tsx`).
- Recommended next focus: D1 (Postgres pool tuning) — foundational for stability, no external credentials required, and a prerequisite for safer database usage when building cafe/check-in APIs.
- Updated `docs/agent/current-state.md` and `docs/agent/progress-log.md` to reflect Part C merged and D1 as the active focus.

## 2026-08-10 (shared package)

- Pushed `fix/issue-26-shared-common` (PR #53): created `web/shared/` as the
  single source for POI types, UUID validation, worker auth helpers
  (`extractBearer`, `safeEqual`, `json`/`unauthorized`/`internalError`),
  `MAX_UPLOAD_BYTES`, and `validateUploadSize`. Web imports via `@shared/*`;
  workers import via relative paths.
- Removed duplicated `web/lib/validation.ts`, `web/types/places.ts`, per-package
  UUID regexes, per-package auth implementations, and inline size validation.
- Aligned `DEFAULT_SEARCH_RADIUS_KM` to the product default of 10 km.
- All gates green: `preflight.sh`, `web` typecheck/lint/tests/build,
  `poi-service` typecheck/tests, `image-service` typecheck/tests.

## 2026-08-11

- Implemented the remaining Phase 1 backlog on `feat/impl-phase1-remainder`:
  - **D1 — Postgres pool tuning** (`web/lib/db/postgres.ts`):
    - Added configurable `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, and `allowExitOnIdle` from environment variables.
    - Attached `on('error')` handler to the shared pool.
    - Added `closePool()`, `withTransaction()`, and `registerPoolShutdownHandlers()` for graceful shutdown.
    - Marked the module `server-only`.
    - Updated `web/tests/postgres.test.ts` with config, lifecycle, transaction, and shutdown tests.
  - **D4 — Worker deploy docs and placeholders**:
    - Added `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, and `R2_PUBLIC_URL` placeholders with clear replacement comments in `image-service/wrangler.toml`.
    - Replaced `REPLACE_WITH_*` placeholders with `YOUR_*` placeholders and documented the exact `wrangler d1`, `wrangler kv`, `wrangler secret`, and `wrangler d1 migrations apply` commands in `poi-service/wrangler.toml`.
    - Updated `docs/agent/pending-user-actions.md` §6–7 with the placeholder names and deployment steps.
  - **D7 — Atomic `checkin_likes` toggle** (`web/lib/db/checkins.ts`):
    - Added `toggleCheckInLike(userId, checkinId)` using a single CTE transaction that deletes an existing like or inserts a new one, then recomputes `checkins.likes_count` from the `checkin_likes` table.
    - Extracted `isValidUUID` into `web/lib/validation.ts` and reused it in `web/app/api/images/complete/route.ts`.
    - Added `web/tests/checkins.test.ts` covering invalid IDs, insert, remove, and soft-deleted check-in cases.
  - **A2 — Sign-in/sign-out UX hardening**:
    - Rewrote `web/app/auth/actions.ts` `signIn`/`signOut` to return `AuthActionState` errors and redirect on success.
    - Added client `SignInButton` and `SignOutButton` components using `useActionState` for pending/error states.
    - Updated `web/app/page.tsx` to use the new buttons and show the signed-in user's display name with a sign-out CTA.
    - Added `signing_in`, `sign_out`, and `signing_out` i18n keys to `web/messages/en.json` and `web/messages/zh.json`.
    - Added `web/tests/auth/actions.test.ts` and `web/tests/auth/sign-in-button.test.tsx`.
- All gates green:
  - `preflight.sh`
  - `cd web && npm run verify` (93 tests, typecheck, lint, build)
  - `cd image-service && npm run typecheck && npm test` (14 tests)
- Updated `docs/agent/current-state.md`, `docs/agent/implementation-slices.md`, and `web/repo_notes.md`.

## 2026-08-11 (review fixes)

- Ran an independent implementation review on `feat/impl-phase1-remainder` and fixed all blocking findings:
  - **Like toggle CTE** (`web/lib/db/checkins.ts`): added a `checkin` CTE that locks the active row and prevents inserting orphaned `checkin_likes` rows for soft-deleted check-ins.
  - **Pool shutdown** (`web/lib/db/postgres.ts` + `web/instrumentation.ts`):
    - Removed auto-registration of signal handlers at import time.
    - Created `web/instrumentation.ts` to register the shutdown hook explicitly at Next.js server start.
    - Replaced immediate `process.exit(0)` with `process.exitCode` assignment, scheduling a hard exit only if the pool fails to close.
  - **Worker compatibility dates** (`image-service/wrangler.toml`, `poi-service/wrangler.toml`): changed `compatibility_date` to `2024-01-01` with a comment to update intentionally for newer runtime behaviour.
  - **Image completion source** (`web/app/api/images/complete/route.ts`): added `source: { type, id }` to every `StoredImage` and guarded check-in ownership/attachment with `deleted_at is null`.
- Fixed related nits:
  - `web/app/auth/actions.ts` now derives `redirectTo` from `x-forwarded-proto` + `host` when `Origin` is absent.
  - `getBoolEnv` warns on unrecognized values.
  - Extracted `web/app/auth/auth-error-message.tsx` to remove duplicated error markup.
  - `web/tests/postgres.test.ts` cleans up environment variables between tests.
  - `web/tests/checkins.test.ts` uses stricter `PoolClient` typing.
  - Added pending-state and error-display tests for `SignInButton` and `SignOutButton` (`web/tests/auth/sign-in-button.test.tsx`, `web/tests/auth/sign-out-button.test.tsx`).
- All gates green:
  - `preflight.sh`
  - `cd web && npm run verify` (98 tests, typecheck, lint, build)
  - `cd image-service && npm run typecheck && npm test` (14 tests)
  - `cd poi-service && npm run typecheck && npm test` (44 tests)
- Merged to `main` as PR #22.

## 2026-08-12

- Pushed `fix/issue-23-rate-limit-backend` (PR #54): distributed Postgres
  token-bucket rate limiter.
  - `web/lib/rate-limit/postgres.ts` — atomic UPSERT, fail-open on DB errors,
    opportunistic expired-row cleanup.
  - `web/lib/rate-limit.ts` — `createRateLimiter()` picks Postgres when
    `DATABASE_URL` is set, memory otherwise; lazy import keeps the `pg` graph
    out of dev/test unless used.
  - `getClientIdentifier()` prefers `CF-Connecting-IP`, falls back to
    `X-Real-IP` / rightmost `X-Forwarded-For`, and hashes UA + IP for
    anonymous clients.
  - Updated `POST /api/images/upload`, `POST /api/images/complete`,
    `GET /api/places/search`, and `POST /api/places/resolve` to `await`
    `rateLimiter.check()`.
  - Added `web/db/migrations/0003_rate_limits.sql`.
  - Review fix: `CHECK_SQL` parameter placeholders corrected (`$3` for
    `max_requests`).
  - `web/tests/rate-limit-postgres.test.ts` + updated
    `web/tests/rate-limit.test.ts`.
- All gates green: preflight, web typecheck/lint/145 tests/build.

## 2026-08-13

- Pushed `fix/issue-25-images-complete-service` (PR #58): extracted the image
  completion service and made the checkin/gallery writes atomic.
  - `web/lib/images/complete.ts` — `completeImageUpload` with fail-fast
    ownership, remote processing outside the transaction, and both DB writes
    inside one `withTransaction`.
  - `web/app/api/images/complete/route.ts` — thin controller using
    `defaultCompleteUploadDeps()` and mapping `isImageServiceError` to a
    sanitized `image_service_error` response.
  - `web/tests/images/complete-service.test.ts` — service-level tests for
    fail-fast, single-transaction atomicity, and no-cafe path.
- Rebased onto `main` (after PR #54) and resolved route import conflict.
- All gates green: preflight, web typecheck/lint/150 tests/build.

## 2026-08-13 (continued)

- Pushed `fix/issue-24-checkin-likes-trigger` (PR #57): database trigger keeps
  `checkins.likes_count` in sync with `checkin_likes` on insert/delete.
  - `web/db/migrations/0004_checkin_likes_trigger.sql` with
    `sync_checkin_likes_count()`, `trg_checkin_likes_sync`, supporting index,
    and backfill.
- Rebased onto `main` (after PR #58).
- All gates green: preflight, web typecheck/lint/145 tests/build.

## 2026-08-13 (continued again)

- Pushed `fix/issue-27-work-stats-lock` (PR #56): serialize `work_stats`
  read-modify-write with `SELECT ... FOR UPDATE`.
  - `web/lib/stats/aggregate.ts` — `incrementalUpdateWorkStats` and
    `recomputeWorkStats` run inside `withTransaction` and lock the cafe row
    before any read or write.
  - `RunInTransaction` is injectable for unit tests; pure helpers stay
    unchanged.
  - `web/tests/stats/aggregate.test.ts` updated to pass `runInTransaction` and
    assert lock ordering.
- Rebased onto `main` (after PR #57) and resolved the `incrementalUpdateWorkStats`
  row-selection logic to keep the #51 fix (omitted/edited check-in handling).
- All gates green: preflight, web typecheck/lint/147 tests/build.
