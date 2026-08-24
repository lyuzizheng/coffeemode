# Test Coverage — Traceability Matrix (S3)

Source: `docs/agent/test-kit-plan.md` S3 testkit-coverage-doc · Spec authority: `docs/specs/0003-testing-and-ci.md` layers · Slice manifest: `docs/agent/implementation-slices.md`.

## 1. Matrix

Every user trace from the product specs (0001 + 0004 + 0002) maps to a proving file and a gate — login Apple/Google, session refresh (`web/proxy.ts`), cafe create, nearby list, detail, check-in lifecycle (create/edit/delete), likes, navigations, image upload/complete, POI search/resolve, 404 recovery, SEO (sitemap/OG), rate limiting. Layers follow `0003` vocabulary: `unit` = Vitest+RTL pure logic, `mocked` = Vitest with mocked service boundaries, `integration` = real Postgres/PostGIS (`RUN_INTEGRATION=1`) or real MinIO/R2 (`RUN_INTEGRATION=1` + minio), `browser` = local/manual Playwright smoke (`npm run check:visual`).

| # | Trace (user intent) | Spec ref | Layer(s) | Proving file(s) | Gate that enforces it |
|---|---|---|---|---|---|
| T1 | Login Apple / Google — `signIn(provider)` → redirect | 0001 §Auth, 0004 D18a | `unit` + `mocked` | `web/tests/auth/actions.test.ts` (signIn invalid_provider/not_configured/provider_start_failed, OAuth redirect allowlist), `web/tests/auth/supabase-server.test.ts` | `unit` (`npm test`) · `typecheck` |
| T2 | Login callback — code exchange + profile upsert, error → `/?auth=error` | 0001 §Auth | `mocked` | `web/tests/auth/callback.test.ts` (exchange success/failure, upsert failure signs out), `web/tests/profiles.test.ts`, `web/tests/auth/get-user.test.ts` | `unit` · `visual` (banner on home) |
| T3 | Sign out — session clear, cache bust | 0001 §Auth | `mocked` | `web/tests/auth/actions.test.ts` (signOut success/signout_failed) | `unit` |
| T4 | Session refresh — `web/proxy.ts` refreshes only when a Supabase cookie is present (`getSession` not `getUser`) | 0001 §Auth A1, 0004 S22 | `mocked` | `web/tests/proxy.test.ts` (refresh + forward cookies, skip when no cookie, gone-cafe 404 commit) | `unit` |
| T5 | Cafe create (= first check-in) — `POST /api/cafes` fused `cafes`+`checkins(is_creation)`+`work_stats`+gallery, 409 dedupe on `google_place_id`/`apple_poi_id`, tz derive | 0001 §Cafe creation, §Data layer, 0004 API1 | `mocked` + `integration` | mocked: `web/tests/cafes.test.ts` (`createCafeWithFirstCheckIn`, `POST /api/cafes` 201/409/400/401/429, `provisionPhotos` intent check) · real: `web/tests/integration/db.integration.test.ts` (§write paths, §work-profile) | `unit` + `integration` (`npm run test:integration`) |
| T6 | Nearby list — `GET /api/cafes?lat&lng&r` PostGIS distance sort, 10 km cap | 0001 §Search Nearby, 0004 D6 | `mocked` + `integration` | `web/tests/cafes.test.ts` (`listCafesNearby`, `GET /api/cafes` 400 without lat/lng, radius clamp) · `web/tests/integration/db.integration.test.ts` (nearby query) | `unit` + `integration` |
| T7 | Cafe detail — `GET /api/cafes/[id]` + `/cafes/[id]` SSR aggregate shell | 0001 §Rendering `/cafes/[id]`, §Data layer | `mocked` + `integration` | `web/tests/cafes.test.ts` (`getCafe`, `GET /api/cafes/[id]` 404/200) · `web/tests/integration/db.integration.test.ts` (detail row) · `web/tests/seo.test.ts` (publicCafeShell strips `by`/author) | `unit` + `integration` |
| T8 | Check-in create — `POST /api/checkins` sliders+policies+photos (`photo_ids` server-derived `StoredImage`), 500-char note, 6-photo cap, 24h guard | 0001 §Check-in, §Image pipeline, 0004 API3 | `mocked` + `integration` | `web/tests/checkins.test.ts` (`parseCheckInBody`, `createCheckIn` one-tx, `POST /api/checkins` 201/400/401/404/429) · `web/tests/provision-photos.test.ts` · `web/tests/integration/db.integration.test.ts` (write paths) | `unit` + `integration` |
| T9 | Check-in edit — patch updates values only, recency keys off original `visited_at`, recompute caller contribution | 0001 §Aggregation §Repeat weighting, 0004 D12 | `mocked` + `integration` | `web/tests/checkins.test.ts` (create path) · `web/tests/stats/aggregate.test.ts` (`incrementalUpdateWorkStats`, `recomputeWorkStats`) · `web/tests/integration/db.integration.test.ts` (§work-profile edit) | `unit` + `integration` |
| T10 | Check-in soft delete — `deleted_at` set, hide from feed + `cafes.gallery` via `source`, recompute `work_stats`, likes_count trigger | 0001 §Aggregation, 0004 D12 | `mocked` + `integration` | `web/tests/integration/db.integration.test.ts` (§work-profile delete) · `web/tests/stats/aggregate.test.ts` | `integration` |
| T11 | Likes — `POST /api/checkins/[id]/like` toggle, no-self-like 403, atomic `likes_count` sync trigger 0004 | 0001 §Data layer `checkin_likes`, 0004 D8/issue-107 | `mocked` + `integration` | `web/tests/checkins.test.ts` (`toggleCheckInLike`, `POST /api/checkins/[id]/like` 200/403/404/400) · `web/tests/integration/db.integration.test.ts` (§toggleCheckInLike on real SQL, §checkin_likes invariants 0004 sync + 0008 BEFORE INSERT) | `unit` + `integration` |
| T12 | Check-in feed — public `GET /api/cafes/[id]/checkins` Newest default + Helpful, mode-bound opaque cursors 20/page | 0001 §Rendering PEEK/HALF/FULL, 0004 API3/Issue-133 | `mocked` + `integration` | `web/tests/feed-cursor.test.ts` (encode/decode) · `web/tests/discovery-view-model.test.ts` · `web/tests/integration/db.integration.test.ts` (feed queries) | `unit` + `integration` |
| T13 | Navigations — `POST /api/navigations` + outcome funnel, anonymous sessions, prompt queue | 0001 §Navigation→check-in prompt, 0004 API5 | `mocked` + `integration` | `web/tests/navigations.test.ts` (`parseNavigationBody`, `recordNavigation`, `POST /api/navigations` 201/400/404) · `web/tests/integration/db.integration.test.ts` (§write paths navigations) | `unit` + `integration` |
| T14 | Image upload — `POST /api/images/upload` auth-gated presigned R2 PUT, 10 MB cap, `image_upload_intents` binding | 0001 §Image pipeline, 0004 D28 | `mocked` + `integration` | `web/tests/images/upload-route.test.ts` · `web/tests/image-uploads.test.ts` · `web/tests/common.test.ts` (validation) · `web/tests/integration/images.integration.test.ts` (presign→PUT→HEAD, 403 tampered type, 404 missing, intent single-use) | `unit` + `integration:images` (`npm run test:integration:images`) |
| T15 | Image complete — `POST /api/images/complete` sharp resize (4096/capped/card/thumb q80), atomic gallery tx, `isCover`, `R2HeadObjectError` preserve | 0001 §Image pipeline §Auth, 0004 API6 | `mocked` + `integration` | `web/tests/images/complete-route.test.ts` · `web/tests/images/complete-service.test.ts` · `web/tests/images/processor.test.ts` · `web/tests/images/image-service-client.test.ts` · `web/tests/images/constants.test.ts` · `web/tests/integration/images.integration.test.ts` (complete round-trip, gallery/intent metadata, replay rejection) · `web/tests/integration/orphan-cleanup.integration.test.ts` | `unit` + `integration:images` |
| T16 | POI search — `GET /api/places/search` stored `q&lat&lng&r` haversine sort, `source=google` live external (auth-gated), 10 km cap, stored-only default | 0001 §POI cache service, 0004 D32 | `mocked` | `web/tests/places.test.ts` (searchPOIs/searchExternalPOIs/storeExternalPOIs, GET /api/places/search 200/400/429/503) · `web/tests/config.test.ts` (radius caps from `app.yaml`) | `unit` |
| T17 | POI resolve — `POST /api/places/resolve` maps share URL → POI, host allowlist + per-hop https re-check | 0001 §POI resolve, 0004 #37 | `mocked` | `web/tests/places.test.ts` (resolveMapsUrl, POST /api/places/resolve 200/400/422, host allowlist) · `web/tests/validate-maps-url.test.ts` · `web/tests/share.test.ts` | `unit` |
| T18 | POI persist external refs — `POST /api/places/external` Apple refs via browser MapKit | 0001 §POI Apple | `mocked` | `web/tests/places-external.test.ts` (`POST /api/places/external`) · `web/tests/places.test.ts` (storeExternalPOIs) | `unit` |
| T19 | 404 recovery — SSR `/cafes/[id]` real 404 committed by `proxy.ts` (no soft-404 from root loading), `GET /api/cafes/[id]/recovery` nearby without geolocation prompt | 0001 §Rendering `/cafes/[id]` DG19/DG111, 0004 S18f | `mocked` + `integration` | `web/tests/cafes-recovery.test.ts` (`GET /api/cafes/[id]/recovery`) · `web/tests/proxy.test.ts` (proxy gone-cafe 404) · `web/tests/integration/db.integration.test.ts` (§seo-sharing §gone-cafe location) | `unit` + `integration` · `visual` |
| T20 | SEO — canonical `/cafes/[id]` (id-stable, locale-independent DG110), `hreflang x-default`, JSON-LD `CafeOrCoffeeShop` + `aggregateRating`, dynamic `sitemap.xml`/`robots.txt`/`llms.txt`, OG `overall+hook` + fallback card, shell CDN `s-maxage` | 0001 §Rendering SEO DG104–DG110, 0004 SUI5 | `unit` + `integration` | `web/tests/seo.test.ts` (cafeCanonicalPath, cafeJsonLd, cafeOgImageUrl, ogHookParams, publicCafeShell) · `web/tests/integration/db.integration.test.ts` (§seo-sharing: sitemap lastmod) | `unit` + `integration` |
| T21 | Rate limiting — 4 API buckets (places/images/create/checkin), token-bucket in-memory vs Postgres (`RATE_LIMIT_BACKEND`), 429 + `Retry-After` | 0001 §Image/POI rate limit, 0004 S33, `web/config/rate-limits.yaml` | `unit` | `web/tests/rate-limit.test.ts` (`RateLimiter`, `GET /api/places/search` 429, `POST /api/cafes`/`POST /api/checkins` 429) · `web/tests/rate-limit-postgres.test.ts` (`PostgresRateLimiter`, `mapBucketRow`, `CHECK_SQL`) · `web/tests/config.test.ts` (rate-limits.yaml schema) | `unit` |
| T22 | Hours/timezone — `isOpenAt` evaluates weekly hours in cafe-local IANA tz (incl. DST), `cafes.tz` on create | 0001 §Data layer `cafes.tz`, 0004 issue-77 | `unit` | `web/tests/hours.test.ts` (isOpenAt KST, DST America/New_York, overnight) | `unit` |
| T23 | SW cache — `/api/*` + `/` network-only, no user-specific cache; `RUNTIME_RULES` table-tested | ADR-0003, 0001 §PWA | `unit` | `web/tests/sw.test.ts` (RUNTIME_RULES) | `unit` |
| T24 | Config — product params from `web/config/*.yaml` via `web/lib/config.ts` (no hardcode DG107) | 0001 §Image/POI caps, `docs/specs/app-config` | `unit` | `web/tests/config.test.ts` (appConfig/rateLimits schema, value preservation) | `unit` · `typecheck` |

Notes:

- T5–T15 each have a mocked boundary proof (fast, no Docker) and a real-DB or real-R2 proof (SQL semantics / trigger / storage errors); per `0003:35` the latter is required for migration/SQL/storage changes.
- T16–T18 POI live Google search hits a mocked Worker (no `GOOGLE_PLACES_API_KEY` in CI); see §4 residual gaps.
- Browser column is `npm run check:visual` manual evidence for UI slices (`discovery-sheet`, `seo-sharing`) — no automated Playwright e2e gate yet; see T19/T20 `visual` marker.

## 2. Efficiency — no duplication via helpers (S1)

S1 extracted the pre-S1 duplication (`web/tests/integration/db.integration.test.ts` 892 lines + `images.integration.test.ts` 473 lines shared `provisionTestDatabase`/`runMigrations`/`r2Client`/`presignedPutUrl`/constants inline) into `web/tests/helpers/*` and `web/tests/setup.ts`.

- One writer per production change still holds (`AGENTS.md`). Feature code composes shared helpers, never embeds or duplicates them (DG91).
- Product parameters remain in `web/config/*.yaml` read through `web/lib/config.ts` (DG107); tests in `web/tests/config.test.ts` pin the migration kept values unchanged.
- `vitest.config.mts` excludes `web/tests/helpers/**` from test collection; `web/tests/setup.ts` resets the in-memory rate limiter and cleans up React trees once.
- `npm test` (unit/mocked) stays green without Docker; `RUN_INTEGRATION=1` suites are `describe.skip` by default.

## 3. Infra vs service helpers split

| Helper | Kind | Owns | Used by |
|---|---|---|---|
| `web/tests/helpers/db.ts` | **infra** (Postgres) | `integrationAdminUrl` host-guard, `makeTestDbName`, `provisionTestDatabase`, `runMigrations`, `quotedIdentifier`, `DEFAULT_DB_URL` | `db.integration.test.ts`, `images.integration.test.ts`, `orphan-cleanup.integration.test.ts` |
| `web/tests/helpers/r2.ts` | **infra** (R2/MinIO) | `R2_*` env isolation (`TEST_R2_*`), `r2Client`/`r2Endpoint`, `presignedPutUrl`/`presignedGetUrl`, `headObject`/`putObject`/`deleteObject`/`objectExists`, `makePayload`/`tinyWebP`, `minioReachable` | `images.integration.test.ts`, `orphan-cleanup.integration.test.ts` |
| `web/tests/helpers/auth.ts` | **service** (domain) | `fakeJwt`/`decodeFakeJwt`, `createMockSupabaseClient`/`mockSupabaseServerClient`/`stubGetCurrentUser` | `cafes.test.ts`, `checkins.test.ts`, unit auth tests |
| `web/tests/helpers/fixtures.ts` | **service** (domain) | fixed UUIDs `U1/U2/CAFE_A/CHECKIN_A1`, `seedBaseData`, `fakeProcessUrls`, `fakeProvisionPhotosDeps`, `cafeWorkStats` | `db.integration.test.ts` and any domain integration test |
| `web/tests/helpers/workers.ts` | **infra** (reserved) | placeholder for S2 miniflare/workerd D1/KV helpers; keeps `helpers/index` re-export stable | S2 `poi-service`/`image-service` local bindings |
| `web/tests/helpers/index.ts` | barrel | re-exports above | tests import from `@/tests/helpers` |
| `web/tests/setup.ts` | harness | `beforeEach rateLimiter.reset()`, `afterEach cleanup()` | all Vitest suites |

Infra helpers never import domain logic; service helpers compose infra primitives (e.g., `fixtures.ts` imports `checkUploadIntent` from production but `db.ts` does not).

## 4. Residual gaps — not yet integration-proven

| Gap | Current coverage | What's missing | Unblocks when |
|---|---|---|---|
| Auth E2E (real Supabase exchange) | Mocked: `auth/callback.test.ts`, `auth/actions.test.ts`, `proxy.test.ts`; JWT is an unsigned `fakeJwt` (`helpers/auth.ts`) | End-to-end login with a real Supabase Auth emulator (PKCE code → session cookie → `getUser()` → `profiles` upsert) | S2 `supabase-mock` / `supabase/cli` local Auth emulator, or a JWT helper with a real HS256 signature verified by `supabase/auth` |
| POI live search (Google Places API + D1/KV) | Mocked Worker: `places.test.ts` fakes `fetch` to `POI_SERVICE_URL`; `validate-maps-url.test.ts` only checks the Next.js allowlist | Live Worker → D1 → KV → Google API cache path, food-only D1 filter, D1 antimeridian bbox (issue #38), KV TTL | S2 compose: `miniflare-poi` (D1 `poi-store`, KV `poi-cache`) with local bindings + `wrangler.toml` ids |
| Image service Worker local | Storage proven via real MinIO (`images.integration.test.ts`); Worker itself still mocked (`image-service-client.test.ts`) | `image-service` presign + metadata path through a local workerd/miniflare instance | S2 `miniflare-image` / workerd for `image-service` with `R2_*` → MinIO |
| Browser / Playwright e2e | Manual `npm run check:visual` covers `discovery-sheet` / `seo-sharing` SSR shell; sitemap/OG proven by unit | Automated Playwright route + interaction specs (selection, drag, prompt queue) | `web/e2e/*` + CI `visual-gate` baseline policy (deferred per 0003) |
| Visual regression pixel baselines | `sw.test.ts` / `seo.test.ts` are contract tests, not screenshots | Screenshot baselines and review policy | Accepted baseline policy (0003 visual is non-blocking until then) |
| Map-bound slices | Blocked on Apple Developer Program (#131) — `map-home`, `map-discovery-integration`, `map-creation-entry`, `deeplink-hydration` | All map + MapKit binding traces | Apple MapKit JS token + miniflare/workerd + Playwright |

None of the gaps affect the READY slices (all have at least one mocked or integration row above). The gaps are tracked as S2 follow-ups and do not block `npm run verify` or the `integration` / `images-integration` gates for web changes.

## 5. Slice → trace index (every READY slice has ≥1 row)

| Slice (status) | Traces that prove it |
|---|---|
| `search-filters` (READY) | T16 POI search (stored + live-gated), T24 config `search.maxRadiusKm` |
| `checkin-system` (READY) | T8 create, T9 edit, T10 delete, T14/T15 photo intents + complete, T12 feed cursors |
| `navigation-prompt` (READY) | T13 navigations + prompt-queue (tested via `rate-limit`/`navigations` + future queue unit) |
| `onboarding-geolocation` (READY) | T4 proxy session (onboarding merges `profiles.current_city`) + T6 nearby (city fallback), browser welcome card (visual) |
| `profile-page` (READY) | T2 profiles, T10 delete (profile tabs read filtered `deleted_at`), T12 feed personal scope |
| `issue-33-upload-intents` (COMPLETE) | T14/T15 intent single-use consume |
| `issue-86-server-derived-photos` (COMPLETE) | T8/T15 `photo_ids` → server `StoredImage` |
| `issue-98-auth-error-feedback` etc. (COMPLETE) | T2/T3 auth error codes |

Deterministic gate `.agents/scripts/check-coverage-matrix.sh` enforces: (a) `docs/agent/test-coverage.md` exists, (b) the 24 required traces T1–T24 are present, (c) every `READY` slice in `docs/agent/implementation-slices.md` maps to at least one row in §5.

## 6. References

- `docs/specs/0003-testing-and-ci.md` §Test layers, §Relevant local gates, §Commands, Appendix Coverage traceability — this file.
- `docs/agent/test-kit-plan.md` S1 (helpers) → this doc (S3) → S2 (compose/mocks) can parallel after S1.
- `web/tests/helpers/*` — shared helpers (S1) that removed duplication.
- `web/tests/integration/*` — real-DB / real-MinIO suites (opt-in `RUN_INTEGRATION=1`; CI `integration-gate` / `images-integration-gate` run them when web DB/storage boundaries change).

