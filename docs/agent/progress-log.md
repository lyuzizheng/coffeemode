# Progress Log

## Retention

This log is append-only and bounded. Keep roughly the most recent two months of
entries here; when it grows past that, move the oldest dated sections verbatim
into `docs/agent/progress-log-archive.md` (newest-first) and leave this file with
the recent tail. Archive history, never delete it.

## 2026-08-10 (harness refinement)

- Audited the agent harness (docs/CI/scripts/agent-config) and applied fixes on `chore/harness-refinement`:
  - Consolidated five conflicting always-on rule files (`.cursorrules`, `.cursor/`, `.windsurf/`, `.trae/`, `.github/prompts/`) into one canonical `docs/agent/coding-conventions.md` (corrected to HeroUI v3 / Next.js 16; dropped stale Shadcn/Radix/Spring Boot/MongoDB); tool files are now pointers. Fixed the malformed double frontmatter in the prompt file and the stale `README.md` tech stack.
  - Made the Execution tiers table in `.agents/workflows/development-cycle.md` the single canonical risk-tier definition; removed the duplicate "Consequence escalation" list and pointed `iteration-protocol.md`, the PR template, and the fix-plan template at it.
  - Added an explicit "Bias to action" principle in `AGENTS.md` with a scoped ask-list in `iteration-protocol.md` §7 (accelerator to balance the brakes).
  - Wired `.agents/ROUTER.md` to reference all skills and disambiguated `implementation-cycle` vs `issue-review-fix` triggers.
  - Hardened `harness-self-test.sh` with a shared `assert_mutated` guard so a stale fixture anchor reports as a stale fixture (not a false harness MISS); guarded the undeclared `ruby` dependency in `check-implementation-slices.sh`.
  - De-duplicated the harness script registry (canonical table now only in `.agents/README.md`); added a retention policy + `progress-log-archive.md` for the unbounded log.
- Gates green: `.agents/scripts/preflight.sh` and `.agents/scripts/harness-self-test.sh` (22/22).

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

## 2026-08-10

- Closed the agent feature-dev loop (issue #62):
  - Rewrote `.agents/skills/coffeemode-implementation-cycle/SKILL.md` to orchestrate
    the full lifecycle: orient → issue intake/review → fix-plan comment →
    implementation via `development-cycle.md` → verification/review → PR with
    `Fixes #N` → close issue after merge.
  - Committed `.github/pull_request_template.md` with issue link, fix-plan link,
    type, affected slice, test plan, risk tier, verification evidence, and checklist.
  - Committed `.github/ISSUE_TEMPLATE/fix_plan.md` as the canonical fix-plan
    comment template and aligned it with the new skill.
- All gates green: `.agents/scripts/preflight.sh`.
- Opened PR #63 to close issue #62.

## 2026-08-10

- Fixed issue #30 (proxy resilience and public-route bypass):
  - Wrapped `supabase.auth.getUser()` in `web/proxy.ts` in try/catch; a
    session-refresh failure now falls through instead of 500ing.
  - Updated proxy matcher to skip public/no-auth API routes
    (`/api/health`, `/api/places/*`) so the proxy does not block them.
  - Added a cookie-presence guard so `getUser()` is skipped when the request
    carries no cookies, removing the network round-trip for anonymous traffic.
  - Added `web/tests/proxy.test.ts` coverage for the error path, matcher
    exclusions, and the no-cookie skip.
- All gates green: `cd web && npm run verify` (161 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-10

- Hardened the issue loop (issue #64) with a structured Dedup gate and a Critical fix doctrine:
  - `docs/agent/issue-guidelines.md` gains the **Dedup gate** (component × defect-class vocabulary search, verdict table: same component + same defect → comment on the original; shared root cause → one root-cause issue listing all sites; different → new issue linked both ways; closed + re-appearing → new issue referencing the closed one; dedup verdict recorded in every issue body) and **Critical fix** rules (verify before you trust — correct the issue publicly when its claims are wrong; root cause + sibling sweep 举一反三 in one PR with the full site list stated; push back with evidence; escalate new separable findings as follow-up issues through the gate or comments on the current issue).
  - `coffeemode-issue-submission` skill applies the gate with verdicts and records the dedup check in the body; `coffeemode-issue-review-fix` skill adds verify-before-trust, sibling sweep, duplicate-merge, and escalation steps; scope rules clarify that same-defect sibling fixes are part of the fix, not unrelated refactors.
- All gates green: `.agents/scripts/preflight.sh`.
- Opened PR #65 to close issue #64.
- Fixed issue #34 (poi-service entry point awaits handler promise):
  - `poi-service/src/index.ts` now `return await handleFetch(...)` inside an
    outer `try/catch` so any rejection from the handler is visible to the
    `fetch` promise and any synchronous throw is mapped to a JSON 500.
- All gates green: `poi-service` typecheck/tests, `.agents/scripts/preflight.sh`.
- Fixed issue #29 (OAuth redirectTo validation):
  - `web/app/auth/actions.ts` now derives `redirectTo` from `NEXT_PUBLIC_SITE_URL`
    when configured, falling back to request headers only when the Origin or
    `x-forwarded-proto`+`host` combination matches an allowlist.
  - Allowlist sources: host from `NEXT_PUBLIC_SITE_URL`, plus optional
    `NEXT_PUBLIC_ALLOWED_HOSTS`; with no configuration, only `localhost` /
    `127.0.0.1` / `::1` are accepted.
  - `web/.env.example` documents `NEXT_PUBLIC_SITE_URL` and
    `NEXT_PUBLIC_ALLOWED_HOSTS`.
  - Added `web/tests/auth/actions.test.ts` coverage for configured-site,
    forged-Origin, allowlist, localhost, and non-HTTP schemes.
- All gates green: `cd web && npm run verify` (166 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.
- Fixed issue #43 (createSupabaseServerClient cookie set errors):
  - `web/lib/auth/supabase-server.ts` now distinguishes the expected
    read-only-cookie error in Server Components from real cookie write errors.
  - Read-only context is swallowed silently; other errors are logged with the
    affected cookie names and rethrown.
  - Added `web/tests/auth/supabase-server.test.ts` coverage for success,
    read-only, and oversized/invalid error paths.
- All gates green: `cd web && npm run verify` (170 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.
- Fixed issue #42 (OAuth callback silently drops profile-upsert failures):
  - `web/app/auth/callback/route.ts` now redirects to
    `/?auth=error&reason=profile_upsert` when `upsertProfile` fails, instead
    of silently sending the user home without a `profiles` row.
  - Updated the inline comment to remove the inaccurate "create on demand"
    claim; the retry path is the next OAuth callback with a fresh code.
  - Added `web/tests/auth/callback.test.ts` coverage for missing code,
    successful exchange, exchange failure, and upsert failure paths.
- All gates green: `cd web && npm run verify` (174 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.
- Fixed issue #47 (TanStack Query persisted cache not cleared on sign-out):
  - `web/app/auth/sign-out-button.tsx` now clears the in-memory query cache
    with `queryClient.clear()` and removes the IndexedDB persisted client
    with `idbPersister.removeClient()` after the server action reports success,
    then redirects to `/`.
  - `web/app/auth/actions.ts` `signOut` returns `{ success: true }` instead
    of `redirect("/")` so the client can perform the cache cleanup.
  - Updated `web/tests/auth/actions.test.ts` and
    `web/tests/auth/sign-out-button.test.tsx` for the success-state flow and
    cache-clear behavior.
- All gates green: `cd web && npm run verify` (175 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-16

- UI/UX review round (issue #78, branch `fix/issue-78-uiux-review-round`):
  full design + frontend pass over every existing surface against the
  pure-tool positioning (spec 0004).
  - Focus-ring root cause: the custom `.focus-ring` class collided with
    HeroUI v3's built-in same-named utility, which paints an unconditional
    orange ring — theme toggle, policy chips, offline retry, and color
    swatches all showed a persistent ring. Renamed to `.cm-focus`
    (`web/app/globals.css` + 4 call sites).
  - Homepage rewritten from a bare login wall into an honest first screen
    (`web/app/page.tsx`): positioning line, 01/02/03 steps, and a sign-in
    card that is honestly disabled when auth providers are unconfigured;
    `SignInButton` gains a `disabled` prop.
  - i18n: fixed the `DIMS` `temperature` → `temp` key leak in
    `theme-preview/shared.tsx`; locale negotiation in `web/i18n/request.ts`
    (cookie → Accept-Language → en default) makes the shipped zh catalog
    reachable; new `home.*` keys keep en/zh parity.
  - HeroUI v3 alignment: Select migrated off deprecated
    `selectedKey`/`onSelectionChange` to `value`/`onChange` with
    `<Select.Value />`; button/chip radii pinned to the spec-0002 scale via
    unlayered pins (same mechanism as the existing `.card` pin).
  - Motion: new `useEnterMotion()` hook in `web/lib/motion.ts`
    (mounted && !reduced) fixes the framer-motion SSR hydration mismatch on
    prefers-reduced-motion clients; applied at all 5 enter-animation sites.
  - a11y/mobile: aria-labels on theme toggle, SearchField, Switch; icon-only
    theme toggle on mobile to stop header overflow.
- Filed follow-up issues from the review: #75 (i18n MISSING_MESSAGE CI
  guard), #76 (visual regression gate), #77 (cafe timezone for open-now).
- All gates green: `cd web && npm run verify` (175 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`; Playwright screenshot sweep across
  routes × light/dark × mobile/desktop; independent implementation review
  verdict APPROVE (no P0/P1).

## 2026-08-16 (i18n guard)

- Fixed issue #75 on `fix/issue-75-i18n-guard` (slice `issue-75-i18n-guard`):
  - `web/scripts/check-i18n.mjs` + `check:i18n` npm script: flattens both
    message catalogs to dot-path key sets and exits 1 naming every asymmetric
    key; wired into `npm run verify` and the `application.yml` CI gate.
  - `web/global.d.ts`: next-intl v4 `AppConfig.Messages` augmentation keyed to
    `messages/en.json` — `t()` / `useTranslations()` / `getTranslations()` with
    a key absent from the en catalog now fails `tsc --noEmit`.
  - Sibling sweep: arming typed keys surfaced one latent type-unsound call
    (`td(key)` over a `string[]` in `theme-preview/sections/motion-section.tsx`);
    tightened the `order` state to the `DimKey` union. No other bad keys
    existed anywhere.
  - Fault-injection verified both guards: a zh-only key fails `check:i18n`
    and names the key; a bogus `t()` key fails typecheck. Both reverted.
- All gates green: `cd web && npm run verify` (175 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-16 (visual gate)

- Fixed issue #76 on `fix/issue-76-visual-regression-gate` (slice
  `issue-76-visual-gate`):
  - `web/scripts/visual-smoke.mjs` + `check:visual`: boots the production
    build on a dedicated port, drives Playwright chromium over the public
    route matrix (`/`, `/theme-preview`, `/~offline` × light/dark ×
    mobile/desktop = 12 renderings), and exits 1 on any non-2xx response,
    `console.error`, or `pageerror`. Screenshots land in `web/.visual-smoke/`
    (gitignored) and upload as a CI artifact on failure. No pixel baselines
    yet — step one per the issue is "CI looks at the rendered app".
  - `.github/workflows/visual.yml` — new `visual-gate` workflow (repo's
    per-concern pattern): npm ci → build → `playwright install chromium` →
    `check:visual`; no secrets required.
  - `playwright` added as a web devDependency; `check:visual` deliberately
    stays out of `verify` (browser install is a CI environment concern).
  - Docs synced: spec 0003 automation-scripts + CI-design lists.
- Verified locally for real: production build, 12/12 renderings clean (zero
  console errors on all routes); fault injection (matrix pointed at a
  non-existent route) exits 1 on HTTP 404.
- All gates green: `cd web && npm run verify` (175 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-16 (cafe timezone)

- Fixed issue #77 on `fix/issue-77-cafe-timezone` (slice
  `issue-77-cafe-timezone`). Verify-before-trust corrected the issue's
  assumptions: no open-now logic existed anywhere yet (only UI labels), and
  no code writes `cafes` rows (cafe-creation slice blocked) — so the fix
  lands the tz-correct foundation before any wrong logic can be written.
  - `web/db/migrations/0005_cafe_timezone.sql`: `cafes.tz text` nullable,
    IANA name, with the rationale comment; nullable on purpose — rows
    without tz report open-now as unknown, never wrong.
  - `web/lib/hours.ts` (new, pure, dependency-free): `isOpenAt(hours, tz,
    instant)` evaluates the DB weekly-template shape in the cafe's local
    time via `Intl.DateTimeFormat`; handles overnight windows
    (close <= open spans midnight) and returns `null` for missing/invalid
    tz or hours.
  - `web/tests/hours.test.ts`: 8 tests — cross-timezone (Seoul cafe at UTC
    instants where naive server-time interpretation is wrong), DST boundary
    pair (America/New_York spring-forward: same wall clock, different UTC
    instant — proves IANA, not fixed offset), overnight, boundary semantics,
    null paths, closed-day-vs-unknown distinction, close === open as
    around-the-clock, non-object jsonb payload.
  - Independent-review hardening: `typeof hours` guard (malformed jsonb →
    null) and the 24h/close===open semantics pinned by comment + tests;
    `cafe-creation` slice outcome now carries "populate `cafes.tz` from
    `location`"; `current-state.md` migrations inventory gains 0005.
  - Places API fact-check: Places (New) only offers `utcOffsetMinutes`
    (fixed, DST-unsafe); population will derive IANA tz from coordinates.
    Deferred per the deferral policy (commented on #77): tz population at
    cafe-creation (blocked slice — no write path exists; an uncalled lookup
    helper would violate the cleanup gate), and backfill (no-op: no
    production database exists yet).
  - Spec 0001 cafes schema block synced with the `tz` column.
- All gates green: `cd web && npm run verify` (183 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-16 (domain API routes, PR A)

- Issue #45 PR A on `fix/issue-45-domain-api-routes` (slice
  `issue-45-domain-api-routes`): cafes domain lib + routes. Verify-before-trust
  found the issue's premise half-wrong — `web/lib/db/cafes.ts` and
  `createCafe` never existed, so this PR writes the libs too.
  - `web/lib/db/cafes.ts` (new): `createCafeWithFirstCheckIn` — cafe +
    creator's first check-in + work_stats fold in ONE transaction (stats
    injected into the same connection via `RunInTransaction`; a second
    transaction would self-deadlock on the new cafe row's lock). `tz` is
    derived from coordinates at write time via `tz-lookup` — landing #77's
    deferred population with the first real write path. Unique violation on
    external POI ids maps to `CafeExistsError` carrying the existing id
    (dedupe). Also `listCafesNearby` (ST_DWithin, meters ordering) and
    `getCafe`.
  - `parseCreateCafeBody` validates the fused payload: coordinates ranges,
    `WORK_DIMS`-keyed 0–100 scores, policy enums (incl. explicit `unknown`),
    `isValidWeeklyHours` opening hours, ISO `visited_at` (future rejected).
    Independent review drove the spec-0001 required-on-creation enforcement:
    `scores.overall`, `min_spend`, `max_stay`, non-empty `note`, and >=1
    structural `StoredImage` photo are now hard requirements (the
    differentiating data), not optional pass-throughs.
  - Routes: `POST /api/cafes` (401 without session, 429 per-user write
    budget, 201 fused result, 409 with existing cafe id), `GET /api/cafes`
    (anonymous, lat/lng required — explicit presence check since
    `Number(null) === 0`, range-checked so PostGIS never 500s, radius
    clamps to the 10 km cap convention; fractional radii pass through via
    a `$3::float8` cast — untyped node-pg params default to int4),
    `GET /api/cafes/[id]` (400 non-UUID, 404 missing).
  - `web/types/cafes.ts` (`CafeSummary`/`CafeDetail` — `created_by` NOT
    exposed, creator stays anonymous per spec 0001),
    `web/types/tz-lookup.d.ts` (the package ships no types), CAFES read/write
    rate-limit presets (30/min read, 10/min write). Both read paths wrap
    `work_stats` in `coerceWorkStats` — the DB default `'{}'` is not a
    complete `WorkStats`.
  - `web/tests/cafes.test.ts`: 23 tests — parser matrix incl. the
    spec-required-fields negative set, transaction shape (insert order,
    lng/lat SQL param order, tz param, photos param, stats on the same
    connection), CafeExistsError mapping, 400/401/409/429 route paths,
    radius clamping + fractional passthrough, 404 shape.
  - Deferred on the issue (per policy): PR B (checkins/likes/navigations
    routes) and `mapkit-token` (Apple Developer Program credentials).
- All gates green: `cd web && npm run verify` (206 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-17 (domain API routes, PR B)

- Issue #45 PR B on `fix/issue-45-checkins-routes` (slice
  `issue-45-domain-api-routes`): checkins / likes / navigations routes.
  - Shared check-in parsers (`parseScores`/`parsePhotos`/`parseVisitedAt`
    with field-prefix params, plus `ParseResult`/`fail`) moved from
    `cafes.ts` into `checkins.ts` as exports; `cafes.ts` imports them
    back. The extraction itself is behavior-preserving; `cafes.test.ts`
    still changed in this commit — for the gallery-merge gap fix below.
  - `web/lib/db/checkins.ts`: `createCheckIn` — cafe-exists check (404
    semantics via `CafeNotFoundError`, not an FK 500) → insert
    (`is_creation=false`) → photo auto-merge into `cafes.gallery` with
    `source={type:"checkin",id}` (spec 0001:556) → work_stats refresh on
    the same connection — one transaction. The refresh is a full
    `recomputeWorkStats`, NOT the incremental fold: independent review
    traced that `incrementalUpdateWorkStats` assumes the new check-in is
    the user's latest, so a backdated `visited_at` would subtract the
    wrong "before" contribution and corrupt stats (phantom negative
    policy counts). Recompute is always correct and cheap at MVP scale.
    `parseCheckInBody` requires `cafe_id` + >=1 slider (spec 0001:541);
    policies/note/photos are optional extras. `toggleCheckInLike` now
    throws a typed `CheckInNotFoundError` (same message, so existing
    tests are unaffected).
  - PR A gap fixed (found while planning PR B): the fused creation flow
    never merged the first check-in's photos into `cafes.gallery`. The
    same merge step (`MERGE_GALLERY_SQL` + `galleryPhotosWithSource`,
    exported from checkins.ts) now runs in `createCafeWithFirstCheckIn`.
  - `web/lib/db/navigations.ts` (new): `recordNavigation` — cafe-exists
    check then insert, returns `{id, resolved, created_at}`. The
    prompt-trigger logic (>30min, 1/session) stays client-side; the
    pending-prompt read endpoint is API5 (spec 0004), out of this issue.
    Known benign TOCTOU: the exists check + insert are two pool queries;
    a cafe vanishing between them yields an FK 500, not 404 — no cafe
    delete path exists at MVP.
  - Routes: `POST /api/checkins` (400/401/404/429/201),
    `POST /api/checkins/[id]/like` (400/401/404/429/200
    `{liked, likesCount}`), `POST /api/navigations`
    (400/401/404/429/201). All reuse the CAFES write budget preset
    (10/min) with per-route keys. NOTE for the UI slice: likes are the
    highest-frequency write — re-tune the like budget before the
    note-list UI lands (review flag).
  - Tests: `web/tests/checkins.test.ts` rewritten (23 tests — parser
    matrix incl. >=1-slider enforcement, transaction shape,
    gallery-merge skip without photos, typed errors, route paths, 429),
    `web/tests/navigations.test.ts` (8 tests). cafes.test.ts happy path
    extended for the gallery merge (8 statements).
- All gates green: `cd web && npm run verify` (232 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-17 (service worker API cache, #46)

- Issue #46 on `fix/issue-46-sw-api-cache` (slice `issue-46-sw-api-cache`).
  Verify-before-trust: the issue's quoted `sw.ts:57-65` NetworkFirst rule
  no longer exists (rules moved to `web/lib/sw-rules.ts` in the 2026-08-09
  F4 refactor, which deliberately omitted then-nonexistent routes). The
  live hole: serwist `defaultCache` (spread after `RUNTIME_RULES`) has a
  same-origin `/api/` catch-all — NetworkFirst, cacheName `apis`, 24h
  maxAge, 10s network timeout. The #45 domain routes (`GET /api/cafes`,
  `/api/cafes/[id]`) fell through into it; the Cache API ignores the
  server's `Cache-Control: no-store`. Stale user-location-parametrized
  responses for up to a day.
- Fix: one catch-all `network-only` rule for `/api/` in `RUNTIME_RULES`
  (after `auth`, before the asset rules — first-match-wins puts it ahead
  of defaultCache), retiring the whole bug class for present and future
  API routes. Redundant per-route rules (`images-api`,
  `health-and-places`) removed — same strategy, earlier position.
  ADR-0003 §3's `/api/cafes/*` NetworkFirst row amended to the catch-all
  network-only (it predated the F4 refactor; this PR makes it wrong, not
  just unimplemented).
- Tests: `sw.test.ts` — 7 rules now; every live `/api/*` family (images,
  health, places, cafes, cafes/[id], navigations) asserts `["api"]`;
  the dead-path guard keeps `/cafes/` and `/profile` (the #45 routes were
  promoted out of it).
- All gates green: `cd web && npm run verify` (233 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-17 (image upload intents, #33)

- Issue #33 on `fix/issue-33-upload-intents` (slice `issue-33-upload-intents`):
  presigned uploads were not bound to the uploading user — a leaked upload
  URL could be completed by anyone against a target THEY own.
  - Migration `0006_image_upload_intents.sql`: `image_upload_intents
    (image_uuid pk, user_id → profiles cascade, created_at)`. No cleanup
    cron at MVP (orphan rows are tiny; follow-up for the nightly job).
  - `web/lib/db/image-uploads.ts` (new): `recordUploadIntent` (on upload),
    `checkUploadIntent` (fail-fast read-only pre-check),
    `consumeUploadIntent` (single-use `DELETE ... RETURNING`, freshness
    window 1h vs the 10min presigned TTL; takes an optional query fn so it
    runs INSIDE complete's transaction — replay/mismatch rolls the attach
    back, and a transient processing failure doesn't force a re-upload).
  - `web/lib/images/complete.ts`: two new injected deps
    (`checkUploadIntent` before ownership/remote work; `consumeUploadIntent`
    first inside the atomic tx). Failure maps to the existing 404 — no
    oracle on whether the UUID exists.
  - `POST /api/images/upload` records the intent after the worker returns;
    intent-record failure → 500 (an unrecorded UUID would 404 at complete).
  - Binding enforced entirely in the Next.js app — the worker contract is
    unchanged (it trusts the service token); no worker deploy, no new env.
  - Tests: `tests/image-uploads.test.ts` (7 — param order, freshness
    window, single-use, injected-tx path); `complete-service.test.ts` +
    `complete-route.test.ts` rewired for the intent steps (route tests now
    use a real-UUID user id) + new intent-failure paths (pre-check → no
    remote work; consume-0-rows → attach rolled back; replay → 404).
- All gates green: `cd web && npm run verify` (246 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`. Deployment: apply migration 0006.

## 2026-08-17 (Postgres sslmode fail-closed, #41)

- Issue #41 on `fix/issue-41-ssl-fail-closed` (slice `issue-41-postgres-ssl`):
  `web/lib/db/postgres.ts` silently disabled CA validation for
  `sslmode=require`/`prefer` and fell back to plaintext on unrecognized values.
  - New mapping: `require`/`prefer`/`verify-ca`/`verify-full` →
    `ssl: { rejectUnauthorized: true }` (strict CA validation; Node verifies
    the hostname by default when a servername is present, so
    verify-ca/verify-full are equivalent here).
  - New explicit opt-in `sslmode=allow-self-signed` →
    `{ rejectUnauthorized: false }` for self-managed VPS certs (MITM risk is
    now a deliberate choice, not a silent default).
  - Unrecognized `sslmode` now throws at pool-config time (fail closed)
    instead of warning and downgrading to plaintext — including an empty
    `sslmode=` and wrong case (`REQUIRE`); `disable` and no-sslmode
    behavior unchanged.
  - Docs: `web/.env.example` documents all supported values; ADR-0002
    consequence bullet revised in place with an issue-#41 note; the
    operator checklist in `pending-user-actions.md` points self-signed
    deployments at `allow-self-signed`.
  - Deployment note: existing deployments using `require`/`prefer` with a
    self-signed cert must switch to `sslmode=allow-self-signed`.
  - Tests: `tests/postgres.test.ts` — parameterized mapping updated (6 cases)
    and the warn-and-downgrade case replaced by fail-closed throw assertions
    (unknown / empty / wrong-case sslmode).
- All gates green: `cd web && npm run verify` (249 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-17 (timing-safe token compare, #35)

- Issue #35 on `fix/issue-35-timing-safe-token` (slice
  `issue-35-timing-safe-token`): the shared `safeEqual` branched on token
  length — on mismatch it compared the expected secret with itself, so the
  work done was O(len(secret)) and the early length check leaked length
  information. (Issue evidence pointed at the pre-#26 copies; the code now
  lives single-sourced in `web/shared/auth.ts`.)
  - `web/shared/auth.ts`: `safeEqual` is now async and hashes both inputs
    with SHA-256 (`crypto.subtle.digest`), then compares the two fixed-length
    32-byte digests via `SubtleCrypto.timingSafeEqual` (pure-JS constant-time
    fallback otherwise). No length branch remains.
  - `poi-service/src/auth.ts` / `image-service/src/auth.ts`: `authorized`
    is async (`Promise<boolean>`). Zero caller changes — all call sites in
    `poi-service/src/handlers.ts` and `image-service/src/index.ts` already
    awaited it.
  - Tests: `web/tests/common.test.ts` awaits the `safeEqual` assertions,
    adds asymmetric empty-string cases, and pins the Workers dispatch
    (stubbed `timingSafeEqual` receives two 32-byte digests); both workers'
    handler-level 401 tests pass unchanged through the awaited boundary.
  - Bookkeeping: flipped `issue-26-shared-common` slice row to COMPLETE
    (closed 2026-08-09, merged in #53) — the stale row tripped the preflight
    dependency check for this slice. Remaining drift filed as issue #89.
- All gates green: `cd web && npm run verify` (250 tests, typecheck, lint,
  build); image-service typecheck + 22 tests; poi-service typecheck + 61
  tests; `.agents/scripts/preflight.sh`.

## 2026-08-17 (server-derived photos on create paths, #86)

- Issue #86 on `fix/issue-86-server-derived-photos` (slice
  `issue-86-server-derived-photos`): `POST /api/cafes` and
  `POST /api/checkins` trusted client-supplied `StoredImage[]` — `by`
  attribution, R2 key paths, and dimensions were all client-asserted, so a
  malicious client could attach refs it never uploaded and forge `by`.
  - Contract change (pre-UI, no client to break): both routes now take
    `photo_ids` (imageUuids from /api/images/upload); cafe creation keeps
    spec 0001's >=1-photo rule. `parsePhotoIds`: UUID shape, no duplicates,
    <=10 per request (processing is sharp/CPU work).
  - `web/lib/images/provision-photos.ts` (new): per id — fail-fast intent
    pre-check BEFORE remote work, then presign + sharp processing OUTSIDE
    the write transaction, building StoredImage server-side (deterministic
    keys, real w/h, `by` = caller, `at` = now; `source` added post-insert).
  - `consumeProvisionedIntents` runs the single-use consume INSIDE the
    creation transaction; a foreign/expired/replayed id throws
    `PhotoIntentError` → full rollback (intent DELETEs roll back too, so a
    transient failure doesn't burn the user's uploads). Routes map it to
    400 `invalid_photos` — generic, no oracle on which id or why.
  - `checkins.photos` entries now carry `source` on the create paths too
    (previously only the gallery merge added it) — matches spec 0001's
    documented record shape and the complete path.
  - Worker contract untouched: `/v1/images/complete` already treats
    targetType/targetId as optional sanitized metadata, so targetless
    processing needs no worker deploy; web's `getProcessUrls` type widened.
  - Deps injection on `createCheckIn`/`createCafeWithFirstCheckIn` follows
    the #25/#33 lazy-default pattern; route tests mock only
    `defaultProvisionPhotosDeps`, so the real provisioning logic runs.
  - Spec 0001 image-pipeline section documents the `photo_ids` contract and
    the `DB record` line now includes `source` (review: it was the lone stale
    projection of the schema's documented shape).
  - Review-driven hardening: pool-level dedupe/cafe-exists pre-checks run
    BEFORE provisioning (a 409/404 no longer burns sharp work; the
    in-transaction checks stay the authoritative gate); worker 404 (upload
    never landed in R2) maps to 400 `invalid_photos` on both create routes
    instead of a misleading 500.
  - Tests: `tests/provision-photos.test.ts` (6 — fail-fast ordering,
    server-derived fields, consume semantics); cafes/checkins lib+route
    tests rewritten to photo_ids (server-derived assertions, intent-failure
    400s, worker-404 400s, replay-race aborts, cap boundary at 10,
    case-insensitive duplicate rejection).
- All gates green: `cd web && npm run verify` (265 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-17 (storeExternal hours_json validation, #39)

- Issue #39 on `fix/issue-39-hours-json` (slice `issue-39-hours-json`):
  mostly stale — the issue's evidence quoted pre-hardening code. Already on
  main: lat/lng range checks, `source: google|apple`, element-type-checked
  `types`/`photo_refs`, string-length caps, validate-all-before-write, and
  atomic multi-row upsert via D1 `batch()` (`d1UpsertPOIs`).
  - Remaining gap landed here: `hours_json` must be parseable JSON
    (`JSON.parse` check in `validateExternalEntry`) — a malformed string
    would have poisoned the stored row for downstream consumers.
  - Test: unparseable `hours_json` → 400 with entry index/reason, valid
    JSON string accepted, nothing written on failure.
- All gates green: `cd poi-service && npm run typecheck && npm test`
  (62 tests), `.agents/scripts/preflight.sh`.

## 2026-08-17 (POI source trust + antimeridian search, #38)

- Issue #38 on `fix/issue-38-placeid-geo` (slice `issue-38-placeid-geo`).
  The haversine NaN sub-item was already fixed on main (`Math.min(1, a)` in
  `geo.ts`); two real gaps landed here:
  - `getPOI` no longer classifies by id prefix up front. KV is probed for any
    id (a hit proves Google — KV only stores raw Google payloads); a D1 row's
    explicit `source` is authoritative: `apple` rows are served as stored
    (even stale, even with a ChIJ-prefixed id), `google` rows pass the
    freshness gate to upstream refresh. The `isGooglePlaceId` prefix
    heuristic is now last-resort only, deciding upstream-vs-404 for
    never-seen ids. No API contract change: no caller could supply `source`
    today, and resolve-flow ids always match the heuristic anyway.
  - `d1SearchPOIs` longitude bounding box wraps across the antimeridian:
    `(lng BETWEEN ? AND ? OR lng BETWEEN ? AND ?)` with bounds normalized by
    new `geo.wrapLng`; boxes spanning ≥360° of longitude (near-pole searches)
    skip the lng prefilter entirely and rely on the haversine post-filter.
  - Tests: wrapLng units; stale ChIJ-prefixed apple row served without
    upstream; stale non-prefix google row refreshed; search across ±179.9°;
    near-pole all-longitude search. `FakeD1` learned the OR-ed lng pair.
- All gates green: `cd poi-service && npm run typecheck && npm test`
  (69 tests), `.agents/scripts/preflight.sh`.

## 2026-08-17 (Maps share-URL host allowlist + redirect re-validation, #37)

- Issue #37 on `fix/issue-37-share-url-hosts` (slice `issue-37-share-url-hosts`):
  - `web/lib/places/validate-maps-url.ts`: dropped the `endsWith(".google.com")`
    suffix match (admitted `drive.`/`mail.` subdomains and bare `apple.com`,
    rejected regional domains). Now: exact hosts (`goo.gl`, `maps.app.goo.gl`,
    `maps.apple.com`) + regional Google pattern — `google.com`,
    `google.<ccTLD>`, or `google.<co|com|org|net|ac|gov|edu>.<cc>` with
    optional `www.`/`maps.` prefix — wide enough for `google.co.uk` /
    `google.com.sg`, tight enough to exclude attacker-registrable TLD shapes
    (`google.evil.io`, `google.zip`; caught in review). https required.
  - `poi-service/src/url.ts`: new exported `isMapsHost` with the same
    semantics (keep-in-sync comment on both sides — no shared package exists
    between web/ and the worker). `resolveShareUrl` gates the initial URL
    (https + maps host, else `{}` → 422) and re-validates every redirect
    `Location` (https + maps host, else stop); malformed `Location` headers
    no longer throw into the router's 500 catch-all. `parseMapsUrl` stays a
    pure parser.
  - Tests: worker +10 (isMapsHost accept/reject incl. attacker TLDs, crafted
    evil URL with embedded place id, off-allowlist redirect, https→http
    downgrade, malformed Location, relative redirect, short→short chain,
    userinfo URL); web +9 (new `tests/validate-maps-url.test.ts`, route-level
    http/subdomain/lookalike rejections).
- All gates green: `cd poi-service && npm run typecheck && npm test`
  (79 tests), `cd web && npm run verify` (274 tests, typecheck, lint,
  build), `.agents/scripts/preflight.sh`.

## 2026-08-17 (R2 public host single-source + drift guard, #40)

- Issue #40 on `fix/issue-40-r2-public-host` (slice `issue-40-r2-public-host`):
  - `web/lib/images/constants.ts`: `R2_PUBLIC_HOST` stays a static constant —
    env derivation at module scope is impossible because the serwist SW build
    keeps `process.env.*` as a runtime reference (`process` is undefined in a
    worker → SW install would break; verified empirically with a sentinel
    build). New `assertR2PublicUrlMatches` is called from `next.config.ts`:
    a drifted `NEXT_PUBLIC_R2_PUBLIC_URL` now fails the build loudly instead
    of silently desyncing loader / SW cache matcher / remotePatterns.
  - `web/lib/images/loader.ts`: added `"use client"` (loaderFile ships in the
    client bundle); fixed `isR2Image` host-prefix check to require a path
    boundary so `images.coffeemode.app.evil.com` no longer matches.
  - `web/next.config.ts`: removed the `**.r2.cloudflarestorage.com` wildcard
    remotePattern (any account/bucket was loadable); only the single-source
    host remains. Raw R2 endpoints are upload-only, never rendered.
  - `web/.env.example`: `R2_PUBLIC_URL` → `NEXT_PUBLIC_R2_PUBLIC_URL`,
    documented as an optional drift guard.
  - Tests: new `tests/images/constants.test.ts` (8 — constant value, drift
    guard accept/reject/garbage, loader mapping + passthrough, isR2Image
    boundary).
- All gates green: `cd web && npm run verify` (282 tests, typecheck, lint,
  build), sentinel-env build fails with the expected drift error, default
  build's `serwist/sw.js` inlines the static host with zero `process.env`
  references, `.agents/scripts/preflight.sh`.

## 2026-08-17 (slice-table drift cleanup, #89)

- Issue #89 on `docs/issue-89-slice-drift` (bookkeeping, no slice):
  verified each IN-PROGRESS row against shipped code and flipped four to
  COMPLETE with merge refs — `issue-23-rate-limit-backend` (#54),
  `issue-24-likes-trigger` (#57; also corrected its Outcome: the trigger is
  migration 0004, not 0003), `issue-25-complete-service` (#58),
  `issue-27-stats-locking` (#56). Issue #24 itself stays OPEN for the JSONB
  normalization remainder, tracked separately.
  - `current-state.md` reconciled: #27 was "pending review/merge" (merged
    via #56); "What's next" item 1 (merge `feat/impl-phase1-remainder`)
    contradicted the same file's Phase/Latest-review sections (merged as
    PR #22) — removed and renumbered.
- Gate: `.agents/scripts/preflight.sh` green (no code changes).

## 2026-08-17 (checkins index/constraint spec alignment, #36)

- Issue #36 on `fix/issue-36-checkins-indexes` (slice `issue-36-checkins-indexes`):
  new migration `0007_checkins_spec_alignment.sql` reconciles `checkins`
  indexes and the `checkin_likes` unique constraint with spec 0001:168-181.
  - `idx_checkins_cafe` / `idx_checkins_user_cafe`: were `(…, created_at desc)`
    without predicate → now `(…, visited_at desc) where deleted_at is null`.
  - `idx_checkins_user_visited` renamed to the spec name `idx_checkins_user`.
  - `idx_checkins_likes (cafe_id, likes_count desc, visited_at desc)` created
    (was missing); `idx_checkins_photos` already existed (issue evidence
    stale there); additive `idx_checkins_deleted_at` kept.
  - `checkin_likes` unique re-ordered to `(checkin_id, user_id)`: the hot
    `count(*) where checkin_id = ?` (toggle CTE + 0004 trigger) gets the
    leading column; the toggle's `user_id + checkin_id` equality works with
    either order. Verified no app code references index names and that
    aggregate.ts's two queries match the new index shapes.
  - No code changes. No local Postgres available — the migration is
    validated by independent review + preflight, not by live application.
- Gate: `.agents/scripts/preflight.sh` green.

## 2026-08-17 (auth error feedback, #98)

- Issue #98 on `fix/issue-98-auth-error-feedback` (slice
  `issue-98-auth-error-feedback`): the OAuth callback's `?auth=error`
  redirect target now renders visible feedback. New client component
  `web/app/auth/auth-callback-error.tsx` (danger-tinted inline banner,
  icon + text so color is never the only signal, `role="alert"`) renders
  above the home sign-in card; `reason=profile_upsert` maps to a specific
  variant, everything else falls back to the generic message.
  `web/app/page.tsx` now awaits `searchParams` (Next 16 async form).
- i18n: `home.auth_error` / `home.auth_error_profile` in en + zh.
- Tests: `web/tests/auth/auth-callback-error.test.tsx` (3 cases: generic,
  profile_upsert variant, unknown-reason fallback). Web suite 282 → 285.
- Visual probe: `/?auth=error&reason=profile_upsert` screenshotted in
  light + dark mobile — banner legible and on-token in both themes.
- Gate: `npm run verify` (web) + `.agents/scripts/preflight.sh` green.

## 2026-08-17 (app state pages, #99)

- Issue #99 on `fix/issue-99-app-state-pages` (slice
  `issue-99-app-state-pages`): app-level state pages replace framework
  defaults (spec 0002: "Empty/loading/error states: designed, not raw
  text").
  - `web/app/not-found.tsx` — designed 404 (client component under the
    root layout's intl provider): mono kicker, display title, body,
    accent link home.
  - `web/app/error.tsx` — route-segment error boundary with Next 16
    `retry()` (re-fetch + re-render) + home link; the underlying error goes to the console, the UI
    stays generic.
  - `web/app/loading.tsx` — HeroUI Skeleton mirror of the home layout
    (shimmer, never a spinner).
  - `web/scripts/visual-smoke.mjs` — ROUTES gains per-route expected
    status; `/definitely-not-a-route` (expect 404) rejoins the matrix
    (16 renderings). Chromium's own document-404 console error is
    filtered only when it matches the route's expected status.
  - `~offline` retry swaps the bespoke button for HeroUI `Button
    variant="primary"` — one less bespoke control.
- i18n: new `notFound` and `error` namespaces in en + zh (206 keys each,
  parity green).
- Tests: `web/tests/components/state-pages.test.tsx` (4 cases: 404
  render + home link; error render, retry() callback, console logging).
  Web suite 285 → 289.
- Gate: `npm run verify` (web) + visual-smoke 16 renderings clean +
  `.agents/scripts/preflight.sh` green.

## 2026-08-17 (harness UTF-8 pinning, #104)

- Issue #104 on `fix/issue-104-harness-utf8`: the Ruby harness checkers read
  repo files without an explicit encoding. Under a non-UTF-8 locale
  (`LANG=`/`LC_CTYPE=C`) Ruby's default external encoding becomes US-ASCII and
  preflight crashes with `invalid byte sequence in US-ASCII` on canonical
  UTF-8 content in `docs/agent/implementation-slices.md`. Pinned
  `encoding: "UTF-8"` on all four harness read sites
  (`implementation-slices.rb` x2, `check-codex-agents.sh`,
  `check-ci-workflow.sh`). Verified: preflight green under
  `env LC_ALL=C LANG=` and unchanged under UTF-8 locales. Harness-only change;
  no product behavior touched.
## 2026-08-17 (auth error codes, #103)

- Issue #103 on `fix/issue-103-auth-error-codes` (slice
  `issue-103-auth-error-codes`): auth server actions no longer return raw
  Supabase error strings to the bilingual UI. `signIn`/`signOut` return
  stable codes (`invalid_provider`, `not_configured`,
  `provider_start_failed`, `signout_failed`) typed on `AuthActionState`;
  raw provider detail goes to the server log (`console.error`).
  `AuthErrorMessage` maps codes via an explicit table to new
  `home.auth_err_*` copy; unknown/legacy values fall back to
  `auth_err_generic` — raw text is never rendered.
- i18n: 5 new `home.auth_err_*` keys in en + zh (211 keys each, parity
  green).
- Sibling sweep: `actions.test.ts` now asserts codes + server-log
  passthrough; `sign-in-button`/`sign-out-button` tests assert localized
  copy; new `auth-error-message.test.tsx` covers all four codes, the
  unknown-value fallback (asserts the raw string is NOT shown), and the
  no-error case. Web suite 289 → 292.
- Gate: `npm run verify` (web) + `.agents/scripts/preflight.sh` green.
