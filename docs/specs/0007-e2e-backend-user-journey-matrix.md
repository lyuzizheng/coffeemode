# 0007. E2E Backend User Journey Matrix

## Goal

Prove the full CoffeeMode backend behaves as one coherent product from
real multi-user journeys — not just isolated module contracts. Six user
paths (discovery → creation → identity → check-ins → likes → lifecycle)
run in dependency order against real Postgres/PostGIS in a single
integration suite, seeded by one shared multi-city mock dataset. When
this suite is green, it becomes the authoritative backend regression
signal; the legacy fragmentary tests it subsumes are listed for
retirement in `## Stable decisions` §8.

## Stable decisions

### 1. Suite location and gate

- Proving file: `web/tests/integration/user-journey.integration.test.ts`.
- Runs under the real-DB gate only (`RUN_INTEGRATION=1`), provisioned per
  run via `web/tests/helpers/db.ts` (`provisionTestDatabase` + template
  clone), same as `db.integration.test.ts`. Skipped otherwise so
  `npm test` stays green without Docker.
- Gate: `cd web && npm run test:integration` (extended to include the new
  file). No new CI job; `.agents/scripts/classify-ci-paths.sh` already
  routes `web/tests/**` to `integration-gate`.
- Service-layer scope: the suite calls `web/lib/db/*`,
  `web/lib/discovery/feed.ts`, and `web/lib/images/complete.ts` directly.
  HTTP route shells (`requireSameOrigin`, rate-limit buckets) stay covered
  by the existing mocked route tests; duplicating them here would couple
  the journey to request plumbing instead of product behavior.

### 2. Shared mock dataset (single source)

- Source: `web/tests/fixtures/mock-dataset.ts` — exports `MOCK_USERS`,
  `MOCK_CAFES` (Singapore ×3, Tokyo ×2, London ×2 with real
  lat/lng + IANA tz), `MOCK_CHECKINS`, `MOCK_PHOTOS`, and
  `seedMockDataset(client)`.
- Deterministic fixed UUIDs (same convention as
  `web/tests/helpers/fixtures.ts`), one profile per journey persona
  (creator U1, visitor U2, solo U3) plus the community service account
  `00000000-0000-4000-a000-000000000001`.
- Seeded cafes carry `city`, `tz`, `opening_hours` (one venue uses an
  explicit `null` closed day), and `price_range` so filter/timezone
  assertions are meaningful; each cafe also carries archetype `scores`
  (0–100 per WORK_DIM) and descriptive `tags`
  (`wifi/outlets/quiet/natural_light/spacious`) as fixture metadata —
  `cafes` has no tags column, so these never touch the schema.
  `work_stats` is derived by the normal recompute path, never hand-written.
- `MOCK_CHECKINS` are `createCheckIn` input payloads (one per persona per
  city, `visitedDaysAgo` backdated clear of the DG64 same-window rule,
  `photoIds` referencing `MOCK_PHOTOS`); they are NOT auto-inserted, so
  journey `n_checkins` transition assertions stay exact. `MOCK_PHOTOS`
  are server-shaped `StoredImage` objects with no storage side effects.
- The dataset doubles as the local-dev seed shape: same rows can hydrate
  a dev database for manual browser verification.

### 3. Path 1 — discovery, map load, nomad filters

- `listCafesNearby({ lat, lng, radiusKm: 10, limit })` near central
  Singapore returns the seeded SG cafes closest-first and excludes the
  Tokyo rows (PostGIS `ST_DWithin` + distance ordering).
- `searchCafesInDb({ city: "tokyo" })` returns only Tokyo rows;
  keyword search (`q`) scopes by name.
- Nomad dimension filters (`filter_wifi`, `filter_outlets`) push down
  into SQL and narrow the set; `filter_max_stay` accepts only known
  labels (`acceptableMaxStayLabels`).

### 4. Path 2 — creation and photo pipeline

- Creation is the fused transaction `createCafeWithFirstCheckIn`
  (spec 0001): one call writes the cafe row (PostGIS geography point,
  `city`, `tz`) plus the creator's first check-in and recomputes
  `work_stats`.
- Photo mounting is proven at the service seam with
  `completeImageUpload` + stubbed image-service deps (fake process URLs,
  no network, no R2): intent → complete → gallery row contains the
  stored image. Real MinIO round-trips stay in
  `test:integration:images`.
- Fresh cafes project `author: null` through `toPublicCafeDetail`
  (the "A nomad" default, spec 0006) until the creator opts in.

### 5. Path 3 — profile and public identity lifecycle

- `updateProfile` writes `displayName` / `currentCity`; `getProfile`
  reads them back.
- Opt-in via `updateProfileIdentity({ showPublicIdentity: true })`
  generates a `slug(display_name)-xxxx` handle and flips both
  `toPublicCafeDetail(...).author` and the feed's `PublicCheckIn.author`
  from `null` to the public handle in the same test.
- Opt-out (`showPublicIdentity: false`) restores `author: null`
  everywhere with rows intact (read-time `CASE WHEN`, no data rewrite);
  the handle stays reserved (`handle_taken` on reuse attempt by design,
  asserted only where stable).

### 6. Path 4 — check-in dynamics (DG64 revisit, DG61 idempotency)

- Second user `createCheckIn` on the journey cafe recomputes the
  weighted aggregate (`work_stats.n_checkins: 1 → 2`).
- DG64: a same-window second `createCheckIn` by the same user throws
  `DuplicateCheckInError` carrying the existing id (the route layer maps
  this to edit mode; the service contract is "no second row"). The
  journey then performs the edit via `updateCheckIn` and asserts the
  note/scores changed with still exactly one live row.
- DG61: two `createCheckIn` calls with the same `idempotency_key` on a
  cafe with no revisit conflict return the same id, the second with
  `deduped: true`, and exactly one row exists.
- `listPublicCheckIns` newest mode returns most-recent-first;
  helpful mode orders by `likes_count` after Path 5 runs.

### 7. Path 5 — like constraints (DG08)

- `toggleCheckInLike(visitor, creatorCheckin)` → `{ liked: true,
  likesCount: 1 }`; toggle again → `{ liked: false, likesCount: 0 }`.
- Self-like (`toggleCheckInLike(author, ownCheckin)`) throws
  `SelfLikeError` (backstopped by the `0008` BEFORE INSERT trigger).

### 8. Path 6 — cafe lifecycle and deletion (DG125)

- Solo cafe (creator U3, only own check-in): `deleteCafe(id, U3)` →
  `{ shell: true, owner_transferred: false }`; own check-ins soft-deleted;
  the id drops out of `listCafeSitemapEntries` (zero live check-ins).
- Community cafe (journey cafe with U1 + U2 check-ins): bare
  `deleteCafe(id, U1)` throws `CafeHasOtherCheckinsError`;
  `deleteCafe(id, U1, { confirm: true })` → `{ owner_transferred: true }`,
  `created_by` moves to the service account, and the public detail
  projects `author: null` (maintainer branding, spec 0006 correction 2).

### 9. Legacy test consolidation (phase 3 audit)

The journey subsumes — but does not yet delete — these fragmentary
suites. Deletion is a follow-up human-confirmed step because each file
also carries narrow unit edges worth keeping:

| Legacy file | Journey coverage | Keep for |
| --- | --- | --- |
| `tests/cafes.test.ts` (49KB) | fused create, nearby, delete, sitemap | route-shell validation errors, body-parser edges |
| `tests/checkins.test.ts` (31KB) | DG64/DG61/likes/feed order | invalid-payload matrices, visitor filters |
| `tests/profile/identity-route.test.ts` | opt-in/out projection | handle regex/cooldown/rate-limit edges |
| `tests/integration/db.integration.test.ts` (87KB) | triggers, recompute, handoff | canonical SQL-semantics reference |
| `tests/cafes-recovery.test.ts` | — (not covered) | keep: 404 recovery has no journey leg yet |

Rule: no file is removed until the journey is green on `main` for one
full CI cycle; removals delete only fully-duplicated `it` blocks, never
whole files blindly.

### 10. Mock-vs-real boundary contracts and Path I/O matrix

Stage-2 tests substitute fakes at exactly three seams
(`web/tests/helpers/mocks.ts`); everything else runs against real
Postgres/PostGIS. Pinned by `web/tests/helpers/mocks.test.ts`.

| Path | Input | Output | Boundary assertion | Mock seam |
| --- | --- | --- | --- | --- |
| 1 discovery | `{ lat, lng, radiusKm: 10, limit }` / `{ city, q, filter_* }` | closest-first cafe rows; city/keyword/dimension narrowing | Tokyo rows excluded from SG radius; unknown `filter_max_stay` ignored | none (real PostGIS rows) |
| 2 creation | fused `createCafeWithFirstCheckIn` + `completeImageUpload` | cafe row + creation check-in + gallery image + recomputed `work_stats` | geography point + `city`/`tz` persisted; `author: null` pre-opt-in | `createMockGooglePlacesResponse` (POI inject), `createFakeImageUpload` (WebP bytes) + stubbed process deps |
| 3 identity | `updateProfile` / `updateProfileIdentity({ showPublicIdentity })` | profile row; `author` flips `null` ↔ public handle | opt-out restores `null` with rows intact; handle stays reserved | `createTestSessionUser` (+ `stubGetCurrentUser`) |
| 4 check-ins | `createCheckIn` / `updateCheckIn` w/ `idempotency_key` | weighted `work_stats` recompute; feed ordering | DG64 same-window → `DuplicateCheckInError`; DG61 replay → same id + `deduped: true`, one row | `MOCK_CHECKINS` payloads (service path, recompute intact) |
| 5 likes | `toggleCheckInLike(visitor, checkin)` | `{ liked, likesCount }` toggle symmetry | self-like → `SelfLikeError` (trigger backstop) | none (real trigger) |
| 6 lifecycle | `deleteCafe(id, user[, { confirm }])` | tombstone vs ownership transfer to service account | solo → shell + sitemap drop; community bare delete → `CafeHasOtherCheckinsError` | none (real lifecycle) |

- Google POI intercept format: the exact `POISearchResponse` shape
  `searchExternalPOIs` returns — `place_id: ChIJ…`, `source: "google"`,
  `types` containing `cafe`, `business_status: "OPERATIONAL"`,
  `hours_json` as serialized Google `regularOpeningHours`
  (`weekdayDescriptions`), non-empty `photo_refs`, ISO `fetched_at`.
  Live Google stays behind the poi-service worker (cached); tests
  `vi.mock("@/lib/places/poi-client")` and never touch the network.
- Fake Image Buffer spec: minimal valid WebP bytes (`RIFF…WEBP` magic,
  same bytes as `tinyWebP`), `contentType: "image/webp"`, fresh v4
  `imageUuid`, `filename: <uuid>.webp`. Intent → complete runs with
  stubbed `getProcessUrls`/`processImage` (no R2, no sharp); real MinIO
  round-trips stay in `test:integration:images`.
- Session user spec: `{ id (v4), displayName, currentCity, jwt }` where
  `jwt` is the `fakeJwt` HS256 shape decoding to `sub === id`. Profile
  rows stay with the caller's seeder; route tests pair the factory with
  `stubGetCurrentUser({ id })`. Real Supabase Auth is never contacted.

## Data/API/UI behavior when relevant

- All geospatial assertions use real `geography(POINT, 4326)` rows;
  distances come from the query (`distance_m`), never computed in-test.
- Timezone-dependent `open_now` filtering is intentionally NOT asserted
  on wall-clock time (flaky); the journey asserts `tz` persistence and
  deterministic city/score filters instead.
- Feed cursor pagination (`encodeFeedCursor`/`nextCursor`) is exercised
  only to first-page order; deep keyset paging stays in
  `tests/feed-cursor.test.ts`.

## Edge cases

1. Radius boundary: a cafe ~10km out vs one on another continent —
   asserts containment, not meter-exact thresholds (PostGIS spheroid
   noise).
2. DG64 vs DG61 interaction: idempotency replay is proven on a cafe
   with no revisit conflict; combining both keys on one cafe would make
   the failure ambiguous (revisit throws before idempotent insert).
3. Identity cache staleness (CDN `s-maxage 600`, spec 0006 Q6) is a
   read-path CDN property — unassertable at the service layer and
   excluded by design.
4. Concurrent double-tap likes: sequential toggles prove the counter
   symmetry; true race coverage belongs to a k6/loader step, not Vitest.

## Tests / acceptance criteria

- `RUN_INTEGRATION=1 npx vitest run tests/integration/user-journey.integration.test.ts`
  passes against `docker compose up -d --wait postgres`.
- `npm run test:integration` (extended) passes — old + new suites green
  together, proving no helper/template interference.
- `npm run typecheck` and `npm run lint` pass on the new files.
- Each `it` block names its Path (1–6) and DG code where applicable, so
  failures point at the product contract, not the test file.
