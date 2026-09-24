# CoffeeMode Web — File Notes

## 2026-09-24 (BRAWUKA-518 — mobile check-in sheet floats ~15dvh off bottom)

- `web/components/checkin/checkin-drawer.tsx`
  - `Drawer.Content` no longer carries `max-h-[85dvh]` on mobile. The class
    shrank the `fixed inset-0` container, so `items-end` anchored the dialog
    to the container's bottom edge — ~15dvh above the viewport's. The inner
    `Drawer.Dialog` keeps its own `max-h-[85dvh]` / detent `h-[85dvh]`, so the
    sheet now sits flush with the bottom edge. Verified in a real browser:
    dialog bottom 717.4px → 844px on a 390×844 viewport; detent expand
    (`h-[85dvh]` toggle) and collapse still work; the desktop 420px right
    panel is unchanged.
  - Same latent pattern remains in `web/components/search/search-filter-surface.tsx`
    (`max-h-[85dvh]` on both Content and Dialog) — out of scope here.

## 2026-09-23 (BRAWUKA-558 — server redirects off `request.url` origin)

- `web/lib/security/origin.ts`
  - New `getRedirectOrigin(request)` resolves the public redirect origin:
    `x-forwarded-proto` + `host` when allowlisted, else `NEXT_PUBLIC_SITE_URL`,
    else null. `x-forwarded-host` stays untrusted (BRAWUKA-282 P1-1).
  - New `redirectToPath(request, path, status)` builds the redirect on that
    origin, falling back to a relative `Location` when nothing resolves.
- `web/app/auth/callback/route.ts` / `web/proxy.ts` (legacy `/?cafe=` 308)
  - Both stopped deriving redirect targets from `new URL(request.url).origin`,
    which resolves to the internal listener (`http://0.0.0.0:3000`) behind the
    staging proxy and stranded OAuth logins on a dead address.
- Tests: `tests/auth/callback.test.ts` (staging listener regression, forged
  `x-forwarded-host`, relative fallback), `tests/proxy.test.ts` and
  `tests/integration/http-auth-exchange.integration.test.ts` now set `host`
  headers — undici does not synthesize one from the URL.

## 2026-09-21 (BRAWUKA-573 — IndexedDB query cache cross-account leak)

- `web/lib/auth/viewer-id.ts` (new)
  - `getViewerIdFromCookies()` decodes the @supabase/ssr `sb-<ref>-auth-token`
    cookie (base64- JSON, raw JSON, `.N` chunks, legacy bare-JWT
    `sb-access-token`) into the current viewer's user id. Cache-ownership tag
    only — no token validation; data reads stay server-verified.
- `web/lib/query/persister.ts`
  - Stored payload is now `{ owner, client }`: `persistClient` stamps the
    current viewer id, `restoreClient` refuses and deletes entries whose owner
    differs (or pre-owner legacy entries). A shared device can no longer
    hydrate account A's viewer-scoped cache (private cafes, profile) into
    account B's session.
- `web/components/settings/settings-view.tsx`
  - `DeleteAccountSection` exported for direct component tests. The
    delete-account cache wipe itself landed on main via BRAWUKA-540
    (`apiFetch` + `isUnauthorized` → `sessionExpired` gate +
    `idbPersister.removeClient()`/`queryClient.clear()`); this change adds
    no behavior there.
- Tests: `tests/query/persister.test.ts` (owner scoping on fake-indexeddb),
  `tests/auth/viewer-id.test.ts` (cookie decode matrix),
  `tests/components/settings-delete-account.test.tsx` (wipe + navigate +
  sessionExpired gate, `apiFetch` mocked).

## 2026-09-18 (BRAWUKA-473 — UI density consistency pass)

- `docs/specs/0002-design-system.md` §Spacing and radius now codifies the
  concentric radius rule (inner = outer − padding), chip density standards
  (non-interactive `px-2.5 py-1 text-xs rounded-sm`; interactive `h-9 px-3`),
  the 44px effective hit-area floor (`min-h-11` + negative margin for inline
  links), list-title/label/error-title type pairing, skeleton-geometry
  fidelity, and `lib/layout.ts` as the single source for layout numbers.
- Components: profile cards/tabs and FeedModeTabs moved to the canonical
  `rounded-md`/`rounded-sm` concentric pair; bordered elements missing a
  radius got `rounded-md`; chip paddings unified; form labels, list titles,
  and error-page titles aligned to the type pairing; CloseTrigger and
  SignOutButton hit areas raised to 44px.
- Loading surfaces: `app/(home)/loading.tsx` is now a map-shell skeleton (search
  capsule + account chip + collapsed bar + PEEK cards);
  `app/profile/loading.tsx`, `detail-content`, `desktop-discovery`,
  `mobile-sheet`, and `checkin-feed` skeletons mirror real layout geometry.
- `scores.tsx` duplicated `w-[88px]` label column extracted to
  `DIM_LABEL_CLASS`.

## 2026-09-13 (BRAWUKA-209 — dark sage hover residual)

- `app/globals.css`
  - Added `--secondary-hover` in both themes (light 40.0%, dark 62.0% — one
    step toward the theme's ink, mirroring `--accent-hover`) and mapped
    `--color-secondary-hover` in `@theme`.
- `app/theme-preview/sections/buttons-section.tsx`
  - Filled secondary example now uses `hover:bg-secondary-hover` instead of
    `hover:bg-secondary/90`; the 90% mix graded 3.99:1 in dark, the token
    reads 5.52:1.
- `app/theme-preview/sections/color-section.tsx`
  - Added the `secondary-hover` swatch to the brand token group.
- `tests/design-tokens-contrast.test.ts`
  - Added `secondary-hover/secondary-foreground` to the AA-gated pairs.

## 2026-08-08 Part A (feat/impl-design-tokens)

- `app/globals.css`
  - Added `--secondary` / `--secondary-foreground` sage brand tokens in light and dark blocks.
  - Codified small radius scale (`--radius-sm/md/lg/xl`) and pinned `--radius` / `--field-radius` to `--radius-md`.
  - Pinned `.card` to `var(--radius-md)` (4px).
  - Added `--color-secondary*` mappings in `@theme` for Tailwind v4 utilities.
  - Verified `@theme` shadow tokens and removed the second shadow from `--shadow-map` to match the spec.

- `app/providers.tsx`
  - Mounted `<Toast.Provider>` from `@heroui/react` at the top level of the provider tree.

- `messages/en.json` / `messages/zh.json`
  - Added `profile`, `create`, `checkIn`, `success`, and `search` namespaces.
  - Added `themePreview` keys for the new prototype sections.

- `app/theme-preview/sections/score-slider-section.tsx`
  - Static HeroUI Slider prototype for all 0–100 check-in dimensions plus overall.

- `app/theme-preview/sections/policy-chips-section.tsx`
  - Reusable `PolicyChips` component and selectable policy chip group using the sage secondary token (one policy dimension removed per DG125; see `docs/alignment-temp/alignment-progress.md`).

- `app/theme-preview/sections/check-in-success-section.tsx`
  - `CheckInSuccessCard` bottom-card prototype with cafe name, new work score, actions, and a subtle coffee-steam hint.

- `app/theme-preview/sections/profile-section.tsx`
  - `ProfileHeader` with avatar, name, city, stats row, and tabbed empty-state lists for My Cafes / My Check-ins.

- `app/theme-preview/sections/search-filter-section.tsx`
  - `SearchFilter` prototype with city `Select`, dimension-minima `Slider`s, `PolicyChips`, and `open_now` `Switch`.

- `app/theme-preview/theme-preview.tsx`
  - Wired all new prototype sections into the `/theme-preview` page.

- `app/theme-preview/preview-sections.tsx`
  - Re-exported the new section components for the barrel import.

- `app/theme-preview/sections/color-section.tsx`
  - Added `secondary` and `secondary-foreground` swatches to the brand token group.

## 2026-08-09 Part B (feat/impl-auth-middleware)

- `web/proxy.ts`
  - Supabase SSR session-refresh proxy using the Next.js 16 `proxy` convention.
  - Exports `proxy` and `config.matcher` to skip static/public routes and
    public/no-auth API routes.
  - Refreshes tokens and forwards refreshed cookies only when a Supabase session
    cookie is present. (Hardened further on 2026-08-13; see that entry.)

- `web/db/migrations/0002_checkins_and_indexes.sql`
  - Adds `updated_at`, `deleted_at`, `likes_count` to `checkins`.
  - Creates the `checkin_likes` table.
  - Documents the `source` field on `StoredImage` records in `cafes.gallery` / `checkins.photos`.
  - Adds Phase 1 indexes: `idx_cafes_created_by`, `idx_cafes_apple_poi_id`,
    `idx_profiles_current_city`, `idx_checkins_user_visited`, `idx_checkins_deleted_at`,
    GIN on `cafes.gallery` and `checkins.photos`, plus the existing full-text / location indexes.

- `web/types/images.ts`
  - Added `StoredImageSource` (`{ type, id }`) and an optional `source` field on `StoredImage`.

- `web/types/checkins.ts`
  - Added `CheckInScores`, `CheckInPolicy` values, `CheckIn`, `CheckInInput`, and `CheckInLike` types.

- `web/types/profile.ts`
  - Added `Profile`, `ProfileStats`, and `ProfileWithStats` types aligned with the `profiles` table.

- `web/lib/stats/aggregate.ts`
  - Implements the recency-weighted `work_stats` aggregation algorithm from spec 0001.
  - Supports per-user `0.6^rank` weighting, optional `social_weight`, policy counting,
    `incrementalUpdateWorkStats`, `recomputeWorkStats`, and `recomputeAllWorkStats`.

- `web/tests/stats/aggregate.test.ts`
  - Unit tests for first check-in, repeat recency weighting, edit recompute,
    soft-delete exclusion, social-weight hook, and composite normalization.

- `web/tests/proxy.test.ts`
  - Unit tests for session cookie forwarding, missing-env fallthrough, and matcher exclusions.

## 2026-08-09 Part C (feat/impl-caching-perf-security)

### Caching / PWA / Query persistence

- `web/next.config.ts`
  - Added `Cache-Control: public, max-age=31536000, immutable` for `/_next/static/:path*`, `/icons/:path*`, and `/fonts/:path*`.
  - Kept no-cache headers for `/serwist/sw.js`, `/manifest.webmanifest`, and `/api/:path*`.

- `web/app/sw.ts`
  - Added `CacheFirst` runtime cache entries for `/_next/static/:path*` (cache `next-static-assets`, 1 year, max 200 entries) and `/icons/:path*` + `/fonts/:path*` (cache `static-assets`, 1 year, max 100 entries).
  - Added `NetworkOnly` entries for document navigations to `/cafes/:path*` and `/profile`.
  - New static entries are placed before `...defaultCache` so they take precedence.

- `web/lib/query/persist-options.ts`
  - Added `buster: "v1"` so persisted cache is invalidated on schema/key changes.

- `web/app/providers.tsx`
  - Added an `onError` callback to `PersistQueryClientProvider` that logs the restore error, removes the persisted client, and clears the query client.

### Images

- `image-service/src/constants.ts`
  - Added `MAX_UPLOAD_BYTES = 10 * 1024 * 1024` (10 MB) and `IMMUTABLE_CACHE_CONTROL`.
  - Documented R2 lifecycle/cleanup recommendation for abandoned `original/` objects.

- `image-service/src/index.ts`
  - `handleUpload` now accepts an optional `size` in the request body.
  - Returns `413` when `size` exceeds the cap and signs the presigned PUT URL with `Content-Length` when `size` is valid.
  - Response includes `maxUploadBytes` and `size`.

- `image-service/src/r2.ts`
  - `presignedPutUrl` accepts a `contentLength` option and includes `Content-Length` in the signed headers.

- `image-service/wrangler.toml`
  - Added lifecycle guidance comments for cleaning up abandoned `original/` objects.

- `web/lib/images/image-service-client.ts`
  - `requestUploadUrl` accepts an optional `size` and forwards it to image-service.

- `web/types/images.ts`
  - Updated `UploadUrlResponse` with `maxUploadBytes` and optional `size`.

### Places

- `web/lib/places/validate-maps-url.ts`
  - New helper that validates `maps_share_url` host against allowed Google/Apple Maps domains and subdomains.

- `web/app/api/places/resolve/route.ts`
  - Validates the maps URL host before proxying and returns `400` with `error: "invalid_maps_url"` for disallowed domains.

- `web/lib/places/constants.ts`
  - Changed `DEFAULT_SEARCH_RADIUS_KM` to `10` and added `MAX_SEARCH_RADIUS_KM = 10`.

- `web/app/api/places/search/route.ts`
  - Clamps the `r` parameter to `MAX_SEARCH_RADIUS_KM` before calling `searchPOIs`.

### Rate limiting

> BRAWUKA-378 removed the Postgres backend below (`PostgresRateLimiter`, `createRateLimiter`, `RATE_LIMIT_BACKEND`, the fail-open path, `rate-limit-postgres.test.ts`) and dropped `rate_limits` via migration 0026 — in-memory is the sole backend.
- `web/lib/rate-limit.ts`
  - Token-bucket `RateLimiter` (memory, dev/tests) plus `createRateLimiter()`
    that selects a Postgres backend when `DATABASE_URL` is set (or
    `RATE_LIMIT_BACKEND=postgres`).
  - `getClientIdentifier` keys anonymous requests on `CF-Connecting-IP` only
    (BRAWUKA-282: `User-Agent`, `X-Real-IP`, and `X-Forwarded-For` are all
    client-forgeable and excluded); requests without `CF-Connecting-IP`
    share one fail-closed `anon:unknown` bucket.
  - `rateLimitResponse` returns `429 Too Many Requests` with `error:
    "rate_limited"` and a `Retry-After` header.
  - Applied to `POST /api/images/upload`, `POST /api/images/complete`,
    `GET /api/places/search`, and `POST /api/places/resolve`.

- `web/lib/rate-limit/postgres.ts`
  - `PostgresRateLimiter`: one atomic UPSERT per `check()`, fail-open on DB
    errors, opportunistic expired-row cleanup, and throttled error logging.

- `web/db/migrations/0003_rate_limits.sql`
  - `rate_limits` table for the distributed token-bucket backend.

### Tests

- `web/tests/rate-limit.test.ts` — unit tests for the in-memory limiter, client identifier, and route-level 429 behavior.
- `web/tests/rate-limit-postgres.test.ts` — Postgres backend, backend selection, and fail-open behavior.
- `web/tests/places.test.ts` — updated for radius cap and maps URL domain validation.
- `web/tests/query/persist-options.test.ts` — query persistence buster and allow-list tests.
- `web/tests/images/image-service-client.test.ts` — optional size forwarding test.
- `image-service/tests/handlers.test.ts` — upload size cap and Content-Length tests.
- `web/tests/setup.ts` — resets the rate limiter between test files.

## 2026-08-11 Phase 1 remainder (feat/impl-phase1-remainder)

- `web/lib/db/postgres.ts`
  - Marked `server-only`; added configurable pool `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`, and `allowExitOnIdle` from environment variables.
  - Attached `on("error")` handler to log pool errors.
  - Added `closePool()` (idempotent), `withTransaction()` helper, and `registerPoolShutdownHandlers()` for SIGTERM/SIGINT graceful shutdown.

- `web/lib/db/checkins.ts`
  - New atomic `toggleCheckInLike(userId, checkinId)` server-only helper.
  - Uses a single CTE transaction to delete or insert a `checkin_likes` row and recompute `checkins.likes_count`, guarding against soft-deleted check-ins.

- `web/shared/uuid.ts`
  - New shared `isValidUUID` helper; replaced the local duplicate in `web/app/api/images/complete/route.ts`.

- `web/app/auth/actions.ts`
  - `signIn` and `signOut` now accept `useActionState` payloads and return `AuthActionState` errors.
  - `signIn` calls `redirect()` on success.
  - `signOut` returns `{ success: true }`; the `SignOutButton` client component clears caches and redirects.

- `web/app/auth/sign-in-button.tsx` / `web/app/auth/sign-out-button.tsx`
  - New client buttons using `useActionState` with `isPending` and inline error display.

- `web/app/(home)/page.tsx`
  - Wired `SignInButton` (Apple + Google) and `SignOutButton`; shows signed-in display name and session text.

- `image-service/wrangler.toml`
  - Replaced placeholder values with `YOUR_*` placeholders and added explicit replacement comments for `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, and the R2 bucket binding.

- `poi-service/wrangler.toml`
  - Replaced `REPLACE_WITH_*` placeholders with `YOUR_*` and documented `wrangler d1 create`, `wrangler kv namespace create`, `wrangler d1 migrations apply`, and secret commands.

- `docs/agent/pending-user-actions.md`
  - Updated §6 (image-service deploy) and §7 (POI service deploy) with placeholder field names and exact commands.

- Tests
  - `web/tests/postgres.test.ts` — pool config, lifecycle, transaction commit/rollback, and shutdown handler tests.
  - `web/tests/checkins.test.ts` — like toggle insert/remove/deleted/invalid cases.
  - `web/tests/auth/actions.test.ts` — sign-in provider validation, OAuth redirect, and sign-out error handling.
  - `web/tests/auth/sign-in-button.test.tsx` — render tests for Apple/Google buttons.

## 2026-08-11 Phase 1 remainder review fixes

- `web/lib/db/checkins.ts`
  - Hardened the atomic like CTE with a `checkin` CTE that locks the active check-in (`deleted_at IS NULL FOR UPDATE`) and guards the insert so it cannot create orphaned rows for soft-deleted check-ins.

- `web/lib/db/postgres.ts`
  - Removed auto-registration of SIGTERM/SIGINT handlers at import time; handlers are now only registered from `web/instrumentation.ts`.
  - Replaced `process.exit(0)` with `process.exitCode` assignment so the process can drain in-flight work; error path schedules a hard exit only if the pool fails to close.
  - Hardened `getBoolEnv` to warn on unrecognized non-empty values and treat empty strings as the fallback.

- `web/instrumentation.ts`
  - New Next.js 16 instrumentation hook that calls `registerPoolShutdownHandlers()` at server start.

- `image-service/wrangler.toml` / `poi-service/wrangler.toml`
  - Set `compatibility_date` to a date in the past (`2024-01-01`) with a comment to update intentionally.

- `web/app/api/images/complete/route.ts`
  - Added `source: { type, id }` to `StoredImage` records on completion.
  - Guarded check-in ownership and attachment queries with `deleted_at is null`.

- `web/app/auth/actions.ts`
  - `getRedirectTo` validates the request origin against an allowlist (configured site + `NEXT_PUBLIC_ALLOWED_HOSTS`).
  - When the `Origin` header is absent, it falls back to `x-forwarded-proto` + `host`.
  - When the request origin is disallowed, it falls back to `NEXT_PUBLIC_SITE_URL`.

- `web/app/auth/auth-error-message.tsx`
  - New shared client component for auth action errors, reused by `sign-in-button.tsx` and `sign-out-button.tsx`.

- Tests
  - `web/tests/postgres.test.ts` — added environment cleanup in `afterEach` to prevent `DATABASE_URL` leaks between tests.
  - `web/tests/checkins.test.ts` — tightened `withTransaction` mock typing with `PoolClient` and asserted the CTE guards soft-deleted check-ins.
  - `web/tests/auth/sign-in-button.test.tsx` — added pending-state and error-message tests.
  - `web/tests/auth/sign-out-button.test.tsx` — new coverage for render, pending state, and error display.

## 2026-08-12 (issue #25 — image completion service)

- `web/lib/images/complete.ts`
  - New service for `POST /api/images/complete`.
  - Fail-fast ownership check before any remote work.
  - Remote processing (image-service presign + sharp resize + R2 writes) stays
    outside the DB transaction so slow I/O does not hold a connection.
  - Check-in photo append and cafe-gallery merge are executed inside ONE
    `withTransaction` so the two writes commit or roll back together.
  - Deps are injectable; default deps lazily import `pg` and `sharp`.

- `web/app/api/images/complete/route.ts`
  - Reduced to a thin controller: auth, body validation, rate limiting, error
    mapping. Calls `completeImageUpload` with `defaultCompleteUploadDeps()`.

- `web/tests/images/complete-service.test.ts`
  - Service tests for fail-fast, cafe attach, atomicity, no-cafe path, and
    lazy default deps.

## 2026-08-13 (issue #24 — likes_count trigger)

- `web/db/migrations/0004_checkin_likes_trigger.sql`
  - `sync_checkin_likes_count()` trigger on `checkin_likes` recomputes the
    parent check-in's `likes_count` after every insert or delete.
  - Covers the toggle CTE, cascade deletes, and future direct writes that
    bypass the app helper.
  - Adds `idx_checkin_likes_checkin_id` to support the count-by-checkin query.
  - One-time backfill heals any pre-existing drift.

## 2026-08-13 (issue #27 — work_stats row locking)

- `web/lib/stats/aggregate.ts`
  - `incrementalUpdateWorkStats` and `recomputeWorkStats` now run the full
    read-compute-write inside `withTransaction` with `SELECT ... FOR UPDATE` on
    the cafe row, held until COMMIT.
  - `runInTransaction` is injectable (default lazily imports the shared pool),
    keeping the pure math helpers unit-testable.
  - `QueryFn` and `RunInTransaction` types exported for tests.

## 2026-08-13 (post-review fixes for merged PRs #66–#73)

_Applies the P1 findings from an independent critical review. Original issues: #29 (redirectTo allowlist), #30 (proxy session refresh), #42 (callback profile upsert), #47 (sign-out cache clear), and #50 (upstream error body logging)._

- `web/app/auth/actions.ts`
  - Hardened `getRedirectTo` allowlist parsing and matching; see `docs/specs/0001-nextjs-migration.md` §Auth for the full redirectTo contract.
- `web/app/auth/callback/route.ts`
  - On profile upsert failure, the user is now signed out and redirected to `/?auth=error&reason=profile_upsert`.
- `web/app/(home)/page.tsx` / `messages/en.json` / `messages/zh.json`
  - The home page reads `auth`/`reason` query params and displays localized error banners.
- `web/app/auth/sign-out-button.tsx`
  - `idbPersister.removeClient()` failures are caught and logged; the user is always redirected.
- `web/proxy.ts`
  - Replaced `getUser()` with `getSession()` and now skips refresh entirely when no Supabase session cookie is present.
- `web/lib/places/poi-client.ts` / `web/lib/images/image-service-client.ts` / `web/lib/images/processor.ts`
  - Upstream error response bodies are canceled instead of buffered or logged.

## 2026-09-24 (BRAWUKA-444 — incrementalUpdateWorkStats signature narrowing)

- `web/lib/stats/aggregate.ts`
  - `incrementalUpdateWorkStats`'s `changedCheckIn` narrowed to required
    `{ insertedId }`: the full-`CheckIn`-row branch (zero-diff trap on
    already-persisted rows) and the `undefined` branch (`slice(1)` assumed the
    changed row is the latest) are both removed. Edits/soft-deletes use
    `recomputeWorkStats`.
- `web/lib/db/cafes/create.ts`
  - The first-check-in path now passes `{ insertedId: checkin_id }` instead
    of `undefined` (equivalent on a single-row snapshot).

## 2026-09-22 (BRAWUKA-655 — check-in create incremental stats fold)

- `web/lib/stats/aggregate.ts`
  - `incrementalUpdateWorkStats`'s `changedCheckIn` now also accepts
    `{ insertedId }`: the row was just INSERTed in the same transaction, so
    the DB snapshot is the "after" state and the "before" set excludes that
    row. Correct for backdated `visited_at` because the contribution math
    re-sorts by `visited_at` internally.
- `web/lib/db/checkins/create.ts`
  - The create path now folds via `incrementalUpdateWorkStats` instead of a
    full `recomputeWorkStats` (O(user's check-ins) instead of O(cafe's)).
    A raced idempotency dedupe skips the fold — the winner's transaction
    already counted the row.
