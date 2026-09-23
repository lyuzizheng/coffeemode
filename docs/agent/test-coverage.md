# Test Coverage — Traceability Matrix (S3)

Spec authority: `docs/specs/0003-testing-and-ci.md` layers · Slice manifest: `docs/agent/implementation-slices.md`.

> BRAWUKA-682: the `unit`/`mocked` layers were deleted — E2E is the sole test
> mechanism (AGENTS.md §Testing philosophy). Every row below names only
> real-stack proofs: `integration` = real Postgres/PostGIS (`RUN_INTEGRATION=1`)
> or real MinIO/R2, `e2e` = Playwright smoke against a seeded production build
> (`npm run test:e2e`), `browser` = local/manual render evidence
> (`npm run check:visual`), `staging` = the post-merge staging journey. Traces
> whose only proof was a unit spec are marked **GAP** and listed in §4.

## 1. Matrix

Every user trace from the product specs (0001 + 0004 + 0002) maps to a proving file and a gate — login Apple/Google, session refresh (`web/proxy.ts`), cafe create, nearby list, detail, check-in lifecycle (create/edit/delete), likes, navigations, image upload/complete, POI search/resolve, 404 recovery, SEO (sitemap/OG), rate limiting.

| # | Trace (user intent) | Spec ref | Layer(s) | Proving file(s) | Gate that enforces it |
|---|---|---|---|---|---|
| T1 | Login Apple / Google — `signIn(provider)` → redirect | 0001 §Auth, 0004 D18a | `integration` | `web/tests/integration/http-auth-exchange.integration.test.ts` (real PKCE exchange via `supabase-mock` + Postgres `profiles` upsert + real JWT verification) | `integration:http` · `e2e` (sign-in gate in smoke suite) |
| T2 | Login callback — code exchange + profile upsert, error → `/?auth=error` | 0001 §Auth | `integration` | `web/tests/integration/http-auth-exchange.integration.test.ts` (exchange success/failure, upsert failure signs out) | `integration:http` · `browser` (banner on home) |
| T3 | Sign out / account delete — session clear, cache bust; IndexedDB query cache is owner-scoped so a shared device never hydrates another account's viewer-scoped data (BRAWUKA-573) | 0001 §Auth | `integration` | `web/tests/integration/http-user-lifecycle.integration.test.ts` (account lifecycle on real DB) | `integration:http` |
| T4 | Session refresh — `web/proxy.ts` refreshes only when a Supabase cookie is present (`getSession` not `getUser`) | 0001 §Auth A1, 0004 S22 | `integration` | `web/tests/integration/http-auth-exchange.integration.test.ts` (cookie presence drives refresh path) | `integration:http` |
| T5 | Cafe create (= first check-in) — `POST /api/cafes` fused `cafes`+`checkins(is_creation)`+`work_stats`+gallery, 409 dedupe on `google_place_id`/`apple_poi_id`, tz derive | 0001 §Cafe creation, §Data layer, 0004 API1 | `integration` | `web/tests/integration/db.integration.test.ts` (§write paths, §work-profile) · `web/tests/integration/http-cafe-creation-media.integration.test.ts` | `integration` (`npm run test:integration`) + `integration:http` |
| T6 | Nearby list — `GET /api/cafes?lat&lng&r` PostGIS distance sort, 10 km cap; list-fetch failure renders inline-error + Retry, never the empty state (BRAWUKA-231) | 0001 §Search Nearby, 0004 D6 | `integration` + `e2e` | `web/tests/integration/db.integration.test.ts` (nearby query) · `web/tests/integration/http-discovery-filters.integration.test.ts` · `web/scripts/e2e-smoke.mjs` (discovery surface) | `integration` + `e2e` |
| T7 | Cafe detail — `GET /api/cafes/[id]` + `/cafes/[id]` SSR aggregate shell | 0001 §Rendering `/cafes/[id]`, §Data layer | `integration` + `e2e` | `web/tests/integration/db.integration.test.ts` (detail row) · `web/scripts/e2e-smoke.mjs` (SSR shell with DB fixture) | `integration` + `e2e` |
| T8 | Check-in create — `POST /api/checkins` sliders+policies+photos (`photo_ids` server-derived `StoredImage`), 500-char note, 6-photo cap | 0001 §Check-in, §Image pipeline, 0004 API3 | `integration` + `e2e` | `web/tests/integration/db.integration.test.ts` (write paths) · `web/tests/integration/http-checkins-social.integration.test.ts` · `web/scripts/e2e-smoke.mjs` T7 (drawer CTA inside the viewport + `Drawer.Body` scrollable, 360x800 / 390x844 / 1440x900) + T8 (open drawer → set overall → submit → success card → auto-close → toast + `cafe-checkins` refetch, real session via supabase-mock — DG124) | `integration` + `e2e` |
| T9 | Check-in edit — patch updates values + photo deltas (`add_photo_ids` provisioned like create, `remove_photo_ids` detaches from check-in + gallery, 6-cap enforced; BRAWUKA-563), recency keys off original `visited_at`, recompute caller contribution; entries: feed-card overflow menu on own cards (`owned_by_viewer` boolean, no `user_id` leak) + profile history list; cafe page carries no edit entry (owner verdict BRAWUKA-120) | 0001 §Aggregation §Repeat weighting, 0004 D12 | `integration` | `web/tests/integration/db.integration.test.ts` (§work-profile edit) · `web/tests/integration/http-checkins-social.integration.test.ts` | `integration` + `integration:http` |
| T10 | Check-in soft delete — `deleted_at` set, hide from feed + `cafes.gallery` via `source`, recompute `work_stats`, likes_count trigger | 0001 §Aggregation, 0004 D12 | `integration` | `web/tests/integration/db.integration.test.ts` (§work-profile delete) | `integration` |
| T11 | Likes — `POST /api/checkins/[id]/like` toggle, no-self-like 403, atomic `likes_count` sync trigger 0004 | 0001 §Data layer `checkin_likes`, 0004 D8/issue-107 | `integration` | `web/tests/integration/db.integration.test.ts` (§toggleCheckInLike on real SQL, §checkin_likes invariants 0004 sync + 0008 BEFORE INSERT) · `web/tests/integration/http-checkins-social.integration.test.ts` | `integration` + `integration:http` |
| T12 | Check-in feed — public `GET /api/cafes/[id]/checkins` Newest default + Helpful, mode-bound opaque cursors 20/page, `owned_by_viewer` ownership bit (author true / others + anon false, DTO carries no `user_id`) | 0001 §Rendering PEEK/HALF/FULL, 0004 API3/Issue-133 | `integration` | `web/tests/integration/db.integration.test.ts` (feed queries + owned_by_viewer isolation) · `web/tests/integration/helpful-ranking.integration.test.ts` | `integration` |
| T13 | Navigations — `POST /api/navigations` + outcome funnel, anonymous sessions, prompt queue | 0001 §Navigation→check-in prompt, 0004 API5 | `integration` | `web/tests/integration/db.integration.test.ts` (§write paths navigations + prompt-queue eligibility/re-ask/auto-resolve + same-cafe stack resolution on real SQL) | `integration` |
| T14 | Image upload — `POST /api/images/upload` auth-gated presigned R2 PUT, 10 MB cap, `image_upload_intents` binding | 0001 §Image pipeline, 0004 D28 | `integration` | `web/tests/integration/images.integration.test.ts` (presign→PUT→HEAD, 403 tampered type, 404 missing, intent single-use) · `web/tests/integration/http-cafe-creation-media.integration.test.ts` | `integration:images` (`npm run test:integration:images`) |
| T15 | Photo provisioning — `photo_ids` intent pre-check + sharp resize (4096/capped/card/thumb q80) + atomic gallery tx via the creation/check-in write paths | 0001 §Image pipeline §Auth, 0004 API6 | `integration` | `web/tests/integration/db.integration.test.ts` (creation/check-in photo attach, gallery/intent metadata, single-use + isolation) · `web/tests/integration/user-journey-discovery-creation.integration.test.ts` (Path 2 photo pipeline) · `web/tests/integration/images.integration.test.ts` (presign→PUT→HEAD, processor round-trip, intent single-use) | `integration` + `integration:images` |
| T16 | POI search — `GET /api/places/search` stored `q&lat&lng&r` haversine sort, 10 km cap, stored-only; creation-sheet provider registry obeys `search.externalSources` + request-time MapKit readiness prop (DG134/DG143, BRAWUKA-326) | 0001 §POI cache service, 0004 D32 | `integration` | `web/tests/integration/http-discovery-filters.integration.test.ts` (stored search on real DB) | `integration:http` · **GAP**: provider-registry UI branches lost their unit proof |
| T16b | Unified search surfaces — shared `?q&city&filter_*` contract (`parseSearchQuery`/`serializeSearchParams`) across `GET /api/search` and the SSR `/search` page (noindex, DG48); Enter submits the DG46 rich results view in `UnifiedSearchPanel` (immediate fetch, no debounce double-fire, edit reverts to suggestions) | 0001 §Search/§SEO, search-filters-v1 §3/§6 | `integration` | `web/tests/integration/http-discovery-filters.integration.test.ts` (`/api/search` contract on real DB) | `integration:http` · **GAP**: parser round-trip + panel Enter behavior lost their unit proof |
| T17 | POI resolve — `POST /api/places/resolve` maps share URL → POI, host allowlist + per-hop https re-check | 0001 §POI resolve, 0004 #37 | — | **GAP**: only proof was unit (`places.test.ts`, `validate-maps-url.test.ts`, `share.test.ts`) | none — residual gap §4 |
| T18 | POI persist external refs — `POST /api/places/external` Apple refs via browser MapKit | 0001 §POI Apple | — | **GAP**: only proof was unit (`places-external.test.ts`) | none — residual gap §4 |
| T19 | 404 recovery — SSR `/cafes/[id]` real 404 committed by `generateMetadata()` `notFound()`, `GET /api/cafes/[id]/recovery` nearby without geolocation prompt | 0001 §Rendering `/cafes/[id]` DG19/DG111, 0004 S18f | `integration` + `e2e` | `web/tests/integration/db.integration.test.ts` (§seo-sharing §gone-cafe location) · `web/scripts/e2e-smoke.mjs` (404 recovery route) | `integration` + `e2e` · `browser` |
| T20 | SEO — canonical `/cafes/[id]` (id-stable, locale-independent DG110), `hreflang x-default`, JSON-LD `CafeOrCoffeeShop` + `aggregateRating`, dynamic `sitemap.xml`/`robots.txt`/`llms.txt`, OG `overall+hook` + fallback card, shell CDN `s-maxage` | 0001 §Rendering SEO DG104–DG110, 0004 SUI5 | `integration` + `e2e` | `web/tests/integration/db.integration.test.ts` (§seo-sharing: sitemap lastmod) · `web/scripts/e2e-smoke.mjs` (SSR shell + static/offline surface) | `integration` + `e2e` |
| T21 | Rate limiting — 4 API buckets (places/images/create/checkin), in-memory token bucket, 429 + `Retry-After` | 0001 §Image/POI rate limit, 0004 S33, `web/config/rate-limits.yaml` | `integration` | `web/tests/integration/http-write-budget.integration.test.ts` (429 behavior on real routes; `web/tests/setup.ts` resets buckets between specs) | `integration:http` |
| T22 | Hours/timezone — `isOpenAt` evaluates weekly hours in cafe-local IANA tz (incl. DST), `cafes.tz` on create; `open_now` pushed down via `cafe_is_open_at` (DG145-C) with SQL↔JS parity proven on real Postgres; `/api/search` edge cache `city:q:filtersHash` 60s + `cafes.updated_at` version invalidation (DG137-C) | 0001 §Data layer `cafes.tz`, 0004 issue-77, BRAWUKA-25 | `integration` | `web/tests/integration/db.integration.test.ts` (13-fixture × 17-instant parity matrix, invalid tz/hours exclusion, `cafesDataVersion`) · `web/tests/integration/http-discovery-filters.integration.test.ts` (deterministic trio + corrupt/invalid fixtures, X-Search-Cache hit/miss) | `integration` + `integration:http` |
| T23 | SW cache — `/api/*` + `/` network-only, no user-specific cache | ADR-0003, 0001 §PWA | `e2e` | `web/scripts/e2e-smoke.mjs` (static/offline surface + PWA artifact verification in `application-e2e-gate`) | `e2e` · **GAP**: `RUNTIME_RULES` table lost its unit proof |
| T24 | Config — product params from `web/config/*.yaml` via `web/lib/config.ts` (no hardcode DG107) | 0001 §Image/POI caps, `docs/specs/app-config` | `integration` | `web/tests/integration/runtime-config.integration.test.ts` (config load + schema on real boot) | `integration` · `typecheck` |
| T25 | Cafe owner controls + private badge in-app — `owned_by_viewer` bit on `PublicCafeDetail` (no `created_by` leak), visibility Switch + checkin-scoped delete/handoff in the in-app detail, `仅你可见` badge on detail heading + index/PEEK rows + search results + profile 我的咖啡地图 (DG146/DG147, BRAWUKA-515) | 0004 DG146/DG147 | `integration` | `web/tests/integration/db.integration.test.ts` (`getUserCafes` visibility field + owner-only read filter) · `web/tests/integration/http-profile-identity.integration.test.ts` | `integration` + `integration:http` · **GAP**: badge rendering lost its unit proof |
| T26 | POI live search billing — Autocomplete (New) + Place Details (New) two-phase with one `sessionToken` per typing→select pair (BRAWUKA-602): no Place Details billing until a result is picked, and no Text Search call site remains. An abandoned search still bills its Autocomplete requests individually — Google only folds them into the $0 `Autocomplete Session Usage` SKU once a Place Details call closes the session | 0001 §Google Places API (retained), §POI cache service | — | **GAP**: only proof was unit (`poi-service/tests/upstream.test.ts`, `handlers.test.ts`); live billing shape is only observable in the Google Cloud console | none — residual gap §4 |

Notes:

- Every kept proof is a real-stack suite: real Postgres/PostGIS, real MinIO/R2,
  a seeded production build, or staging — per `0003` the real-DB gate is
  required for migration/SQL/storage changes.
- T17/T18/T26 have no automated proof after the unit deletion; see §4 residual
  gaps. The `GAP` markers on T16/T16b/T23/T25 name the sub-behavior that lost
  its unit proof while the trace itself stays integration-proven.
- Browser column is `npm run check:visual` manual evidence for UI slices
  (`discovery-sheet`, `seo-sharing`).

## 2. Efficiency — no duplication via helpers (S1)

S1 extracted the pre-S1 duplication (`web/tests/integration/db.integration.test.ts` 892 lines + `images.integration.test.ts` 473 lines shared `provisionTestDatabase`/`runMigrations`/`r2Client`/`presignedPutUrl`/constants inline) into `web/tests/helpers/*` and `web/tests/setup.ts`.

- One writer per production change still holds (`AGENTS.md`). Feature code composes shared helpers, never embeds or duplicates them (DG91).
- Product parameters remain in `web/config/*.yaml` read through `web/lib/config.ts` (DG107).
- `vitest.config.mts` `include` collects only `tests/**/*.test.*`, so `web/tests/helpers/**` contributes no test files (helpers are reached by direct `../helpers/*` subpath imports); `web/tests/setup.ts` resets the in-memory rate limiter once per spec.
- Every spec under `web/tests/` is `RUN_INTEGRATION=1`-gated and self-skips without it — there is no unit suite to keep green without Docker.

## 3. Infra vs service helpers split

| Helper | Kind | Owns | Used by |
|---|---|---|---|
| `web/tests/helpers/db.ts` | **infra** (Postgres) | `integrationAdminUrl` host-guard, `makeTestDbName`, `ensureTemplateDatabase`, `provisionTestDatabase` (template cloning), `cleanupIntegrationDatabase`, `runMigrations`, `quotedIdentifier`, `DEFAULT_DB_URL`, `DEFAULT_TEMPLATE_DB_NAME` | `db.integration.test.ts`, `images.integration.test.ts`, `orphan-cleanup.integration.test.ts`, `db-helpers.test.ts`, `http-*.integration.test.ts` (direct `../helpers/db` imports) |
| `web/tests/helpers/r2.ts` | **infra** (R2/MinIO) | `R2_*` env isolation (`TEST_R2_*`), `r2Client`/`r2Endpoint`, `presignedPutUrl`/`presignedGetUrl`, `headObject`/`putObject`/`deleteObject`/`objectExists`, `makePayload`/`tinyWebP`, `minioReachable` | `images.integration.test.ts`, `orphan-cleanup.integration.test.ts` (direct `../helpers/r2` imports) |
| `web/tests/helpers/auth.ts` | **service** (domain) | `fakeJwt`/`decodeFakeJwt` | `helpers/mocks.ts` (mints session JWTs for the HTTP/journey suites; see `scripts/supabase-mock.mjs` sync) |
| `web/tests/helpers/http-client.ts` | **service** (domain) | `apiClient`, `buildRouteRequest`, `createHttpTestUsers`, `seedHttpTestUsers`, `setCurrentTestUser`, `resetRateLimits` | `http-*.integration.test.ts`, `runtime-config.integration.test.ts` |
| `web/tests/helpers/mocks.ts` | **service** (domain) | `createTestSessionUser`, journey POI/photo fakes for the three outside-world seams (spec 0007 §10) | `http-*.integration.test.ts`, `user-journey-*.integration.test.ts` |
| `web/tests/helpers/fixtures.ts` | **service** (domain) | fixed UUIDs `U1/U2/CAFE_A/CHECKIN_A1`, `seedBaseData`, `fakeProcessUrls`, `fakeProvisionPhotosDeps`, `cafeWorkStats` | `db.integration.test.ts` and any domain integration test (direct `../helpers/fixtures` imports) |
| `web/tests/setup.ts` | harness | `beforeEach rateLimiter.reset()` | all Vitest suites |

Infra helpers never import domain logic; service helpers compose infra primitives (e.g., `fixtures.ts` imports `checkUploadIntent` from production but `db.ts` does not).

## 4. Residual gaps — not yet integration-proven

| Gap | Current coverage | What's missing | Unblocks when |
|---|---|---|---|
| Auth E2E (real third-party OAuth) | Proven: `tests/integration/http-auth-exchange.integration.test.ts` (BRAWUKA-417) covers PKCE OAuth code exchange via `supabase-mock`, Postgres profile upsert via `/auth/callback`, and real JWT verification via `getCurrentUser()` | Full third-party OAuth provider round-trip (Apple/Google external dialog) remains E2E manual/staging only | Real provider sandbox or staging-only verification |
| POI live search (Google Places API + D1/KV) | `web/tests/integration/http-discovery-filters.integration.test.ts` proves the stored-search path; the live upstream path lost its mocked-Worker unit proof (`poi-service/tests/*` deleted) | Live Worker → D1 → KV → Google API cache path, food-only D1 filter, D1 antimeridian bbox (issue #38), KV TTL, and a real Google billing session | S2 compose: `miniflare-poi` (D1 `poi-store`, KV `poi-cache`) with local bindings + `wrangler.toml` ids; the billing shape itself is only observable in the Google Cloud console |
| Image service Worker local | Storage proven via real MinIO (`images.integration.test.ts`); Worker itself has no automated proof (`image-service/tests/*` deleted) | `image-service` presign + metadata path through a local workerd/miniflare instance | S2 `miniflare-image` / workerd for `image-service` with `R2_*` → MinIO |
| POI resolve + external persist (T17/T18) | None — unit-only proofs deleted | `POST /api/places/resolve` host allowlist + per-hop https re-check, `POST /api/places/external` | An HTTP-lifecycle integration spec for the two routes |
| Parser/UI micro-behaviors (T16b Enter submit, T23 `RUNTIME_RULES`, T25 badge rows) | Parent traces stay integration/e2e-proven | The deleted component/parser unit specs | Browser-E2E coverage of the same surfaces, or accepted gap |
| Browser / Playwright e2e | Automated `npm run test:e2e` Playwright smoke covers Discovery, SSR Shell with DB fixture, 404 Recovery, Static/Offline, Signed-out Profile, Core APIs (Issue #155), check-in drawer geometry (BRAWUKA-217), the check-in submit flow on a real supabase-mock session (BRAWUKA-121/514), and DG124 deep-link hydration (shell → map app at FULL, mobile detents, /?cafe= 308 — `scripts/lib/deeplink-hydration-gate.mjs`); `npm run check:visual` adds the open drawer to the rendered matrix (needs the seeded fixture: `ALLOW_SEED_DEV_DB=1` locally) | Full interactive drag/gesture visual baselines | Map-bound and gesture interaction slices |
| Visual regression pixel baselines | `check:visual` scores painted contrast, not screenshots | Screenshot baselines and review policy | Accepted baseline policy (0003 visual is non-blocking until then) |
| Map-bound slices | `map-home` landed (BRAWUKA-311): e2e T1 asserts the map canvas or designed error state + live sidebar; visual smoke renders `/` in both schemes with the tile host stubbed (`scripts/lib/tile-stubs.mjs`) | Interactive map traces (pin tap → selection, cluster zoom, flyTo) | `map-discovery-integration` / `map-creation-entry` slices |

None of the gaps affect the READY slices (all have at least one integration or e2e row above). The gaps are tracked as S2 follow-ups and do not block `npm run verify` or the `integration` gate (merged DB+MinIO) for web changes.

## 5. Slice → trace index (every READY slice has ≥1 row)

| Slice (status) | Traces that prove it |
|---|---|
| `search-filters` (COMPLETE) | T16 POI search (stored + live-gated), T16b unified search surfaces (SSR `/search` + Enter results view), T24 config `search.maxRadiusKm` |
| `poi-cache-service` (COMPLETE) | T16/T18 stored + external persist, T26 Autocomplete→Details billing pair (BRAWUKA-602) |
| `checkin-system` (COMPLETE) | T8 create, T9 edit, T10 delete, T14/T15 photo intents + provisioning, T12 feed cursors |
| `navigation-prompt` (COMPLETE) | T13 navigations + prompt-queue (record, eligibility, re-ask, resolve, DG79 auto) |
| `onboarding-geolocation` (COMPLETE) | T4 proxy session (onboarding merges `profiles.current_city`) + T6 nearby (city fallback); `web/tests/integration/http-profile-identity.integration.test.ts` (DG122 onboarded/lastLocation persistence), browser welcome card (visual) |
| `helpful-ranking-snapshot` (READY) | T12 feed cursors (Helpful mode) + `web/tests/integration/helpful-ranking.integration.test.ts` (scoring/idempotence/atomic-publish on real Postgres, expired-version 410 restart) |
| `profile-page` (COMPLETE) | T2 profiles, T10 delete (profile tabs read filtered `deleted_at`), T12 feed personal scope |
| `issue-33-upload-intents` (COMPLETE) | T14/T15 intent single-use consume |
| `issue-86-server-derived-photos` (COMPLETE) | T8/T15 `photo_ids` → server `StoredImage` |
| `issue-98-auth-error-feedback` etc. (COMPLETE) | T2/T3 auth error codes |
| `map-home` (COMPLETE) | e2e T1 (map canvas/error state + sidebar, tile host stubbed) + visual `home` entries both schemes; `web/tests/integration/runtime-config.integration.test.ts` pins the `map:` config section |
| `map-discovery-integration` (READY) | e2e T1 + visual `home` entries (selection/marker binding landed with map-home) |
| `map-creation-entry` (READY) | e2e T1 + visual `home` entries (map surface exists to bind) |
| `deeplink-hydration` (COMPLETE) | T2 SSR shell + e2e T2b (desktop hydration handoff, mobile FULL→HALF detent, /?cafe= 308) |

Deterministic gate `.agents/scripts/check-coverage-matrix.sh` enforces: (a) `docs/agent/test-coverage.md` exists, (b) the 26 required traces T1–T26 are present, (c) every `READY` slice in `docs/agent/implementation-slices.md` maps to at least one row in §5.

## 6. References

- `docs/specs/0003-testing-and-ci.md` §Test layers, §Relevant local gates, §Commands, Appendix Coverage traceability — this file.
- `web/tests/helpers/*` — shared helpers (S1) that removed duplication (direct `../helpers/*` subpath imports; no barrel — import the helper file you need).
- `web/tests/integration/*` — real-DB / real-MinIO suites (opt-in `RUN_INTEGRATION=1`; CI `integration-gate` runs them when web DB/storage boundaries change — merged from `integration-gate` + `images-integration-gate`).
