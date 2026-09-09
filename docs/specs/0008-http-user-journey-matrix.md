# 0008. HTTP User Journey Matrix (Real-Client API Simulation)

## Goal

Prove CoffeeMode behaves as one coherent product when driven exactly the way a
real client drives it: every state change and every assertion goes through the
external HTTP API (Next.js Route Handlers, standard `Request` → `Response`),
never through `lib/db/*` internals. This spec composes the founder-mandated
Paths 1–6 into a single time-ordered, causally-linked 4-persona lifecycle,
pins the per-endpoint request/response contracts and reconciliation rules,
lists the legacy tests the suite subsumes, and defines the Stage 2
implementation slicing for BRAWUKA-146. It is the HTTP-layer sibling of spec
0007 (which owns the service-layer journey); where they overlap, 0008 is the
contract a real client can observe. Founder's rule, restated as binding: when
the implementation deviates from this contract, the deviation is filed as a
bug — assertions are never weakened to fit the code.

## Stable decisions

### 1. HTTP-only boundary and harness

- All product-visible behavior is exercised through the Stage 1 harness
  `web/tests/helpers/http-client.ts` (BRAWUKA-147, PR #331 — OPEN at spec
  time; it is a pending-merge dependency and Stage 2 slices start only after
  it lands on `main`). Real harness surface: `createHttpSession(userId)`
  binds a persona to verb shortcuts (`session.post(handler, path, { json })`)
  that run under `runAsHttpUser`, so A/B/C/D interleave safely;
  `createAnonymousSession()` is the User-D read-only posture;
  `buildHttpRequest` builds real headers/cookies/query/FormData;
  `callRouteJson` / `readJsonResponse` return `{ status, body, headers,
  text }`. Each consuming test file installs the auth seam itself with the
  ready-made `httpAuthMockFactory()` — the `vi.mock("@/lib/auth/get-user")`
  call must live in the test file, per the harness header.
- Exactly two non-HTTP seams exist, both harness-owned infrastructure, and
  neither may assert or mutate product state. Neither exists in PR #331 yet —
  both are small harness extensions that land with slice 2A as Stage 2
  prerequisites:
  1. one-time persona provisioning — a harness-owned seeder inserting the
     four persona profile rows under fixed UUIDs
     (`web/tests/helpers/fixtures.ts` convention); no product assertion may
     run through it;
  2. rate-limit bucket reset between Acts — a harness-owned
     `resetRateLimits()` clearing the `rate_limits` table, because the
     `cafes-write` bucket is 10/min shared across cafe writes, check-ins,
     likes, and navigations and a fast full-matrix run would otherwise 429.
- Test code never reads or writes the database for setup, verification, or
  reconciliation. All data对账 happens through User D's GET calls (§10).
- Suite gate: `RUN_INTEGRATION=1` against the provisioned template-clone
  Postgres/PostGIS (`web/tests/helpers/db.ts`) plus MinIO for the image
  round-trip, same CI `integration-gate` footing as the 0007 suites.
  Files live under `web/tests/integration/http-*.integration.test.ts` and
  self-skip without the gate so `npm test` stays green without Docker.

### 2. Personas

| Persona | Role | Writes in the lifecycle |
| --- | --- | --- |
| User A | 先锋探店建店者 (pioneer creator) | Creates Cafe 1 (Singapore) with fused first check-in + photos; toggles public identity on/off; initiates Cafe 1 deletion |
| User B | 高频打卡探索者 (high-frequency explorer) | Creates Cafe 2 (Tokyo); checks into Cafe 1; triggers the DG64 24h revisit → edit flow |
| User C | 社区访客 (community visitor) | Creates Cafe 3 (London, solo); checks into Cafes 1 & 2; exercises the DG61 idempotent retry; second liker; deletes Cafe 3 |
| User D | 独立外部观察者 (independent observer) | No writes. Anonymous reads, then one authenticated read pass; owns the reconciliation ledger (§10) |

Persona UUIDs follow the deterministic convention of
`web/tests/helpers/fixtures.ts`; the community service account is
`00000000-0000-4000-a000-000000000001` (migration 0016).

### 3. Composed lifecycle timeline (Acts 0–8)

The capstone suite runs one causal timeline; later Acts consume state created
by earlier ones. Slice suites (§13) re-run their own slices of the same
contract against self-bootstrapped fixtures.

| Act | Actor(s) | HTTP calls | State carried forward |
| --- | --- | --- | --- |
| 0 Setup | harness | persona provisioning, `resetRateLimits`, POI seam mock | 4 sessions, clean buckets |
| 1 Creation | A, B, C | `POST /api/images/upload` → presigned PUT → `POST /api/cafes` ×3 | Cafe 1 (SG), Cafe 2 (Tokyo), Cafe 3 (London); 3 creation check-ins |
| 2 Discovery | D (anon) | `GET /api/cafes`, `GET /api/search` matrix | distance order, city/filter/open_now/max_stay truth table |
| 3 Cross check-ins | B, C, A, C | `POST /api/checkins` ×4 (B→1, C→1, A→2, C→2 twice w/ same key) | aggregates recomputed; DG61 replay proven |
| 4 Revisit & edit | B | `POST /api/checkins` → 409; `GET /api/checkins/last`; `PATCH /api/checkins/[id]` | DG64 edit mode; Cafe 1 experience_score moves |
| 5 Identity | A | `PATCH /api/profile`, `PATCH /api/profile/identity` on → off | author projection flips, then losslessly restores |
| 6 Reconciliation | D (anon + authed) | GET detail/feed/profile surfaces | full ledger assert (§10) |
| 7 Likes | A, C, D | `POST /api/checkins/[id]/like` toggles; self-like 403; anon 401 | likes_count=2 on B's Cafe 1 check-in |
| 8 Lifecycle | B, C, A | `DELETE /api/cafes/[id]` matrix | Cafe 3 shell; Cafe 1 handed to service account; D re-reconciles |

Likes run after the first reconciliation so helpful-mode ordering is asserted
against a known before/after; deletion runs last because it consumes the
shared cafes.

### 4. Path 1 — discovery, map viewport, compound search filters

Contract correction (binding): geo-nearby lives on `GET /api/cafes`; city,
min-score, `open_now`, and `max_stay` filters live on `GET /api/search`. Any
journey that conflates them is testing a contract that does not exist.

- `GET /api/cafes?lat&lng&radius_km&limit` — anonymous allowed. Missing or
  non-numeric `lat`/`lng` → 400 `invalid_request`. `radius_km` defaults to 10
  and is clamped to 10: a request with `radius_km=50` must still exclude the
  fixture cafe 12 km out (10 km cap, spec 0001/0004). `limit` caps at 50.
  Results order by `distance_m` ascending; empty area → `200 { cafes: [] }`,
  never an error. Anonymous viewers see `visibility = 'public'` only.
  `CafeSummary` never leaks `created_by`; a service-account-owned cafe shows
  `maintainer: "由 CoffeeMode 维护"`.
- `GET /api/search?city=tokyo` — city switch scopes results to Tokyo and
  anchors `reference_point` there. Explicit unknown city → 400
  `invalid_request`, never a silent re-anchor (DG128 — city resolution is the
  real DG128; the Path 3 identity citation in the originating issue text is
  corrected in §6). Omitted city resolves explicit → `cf-ipcity` header →
  `cf-ipcountry` → default `singapore`; the suite simulates the header path
  with `cf-ipcity: tokyo`.
- Min-score filters `filter_wifi|filter_outlets|filter_seats|filter_temp|filter_coffee|filter_overall`
  accept 0–100 thresholds: Cafe 3 (experience_score 40) is excluded by
  `filter_overall=60`. Out-of-range values (e.g. `filter_overall=120`) are
  silently ignored — assert 200 with an unfiltered set, not a 400.
- `open_now=true` is asserted deterministically, never on wall-clock: Cafe 1
  carries 00:00–23:59 hours every day (always open → included), Cafe 2
  carries an explicit `null` closed day for every weekday (closed →
  excluded), Cafe 3 carries no `opening_hours` at all (unknown → excluded).
  Evaluation happens in each cafe's own IANA `tz` (`lib/hours.ts`).
- `filter_max_stay` is an ordinal consensus filter ("cafe consensus ≥
  requested"; `peak` exact-match only). `unknown` parses cleanly but ranks
  below every known label, so it matches any cafe with a `max_stay` consensus
  and no user-facing filter uses it.
  Slice 2A owns an unambiguous fixture (two users both reporting `3h`): in
  for `filter_max_stay=3h`, out for `filter_max_stay=unlimited`. DG126
  re-bucketing is PROPOSED only — nothing here asserts against it.
- Empty-result兜底: an impossible filter combination → 200 with
  `results: []`, `total_count: 0`, `is_weak_results: true` — the product
  answer to "nothing here" is an honest empty state, not an error.
- Response hygiene: `Cache-Control: private, max-age=10, stale-while-revalidate=30`
  and `X-Search-Mode` present; results capped at 10 (DG46); `good_first`
  ranking boosts cafes with `experience_score ≥ 80` or `composite_score ≥ 75`
  (asserted on Cafe 2, experience 88.33, in the capstone).

### 5. Path 2 — cafe creation, first-day check-in, image pipeline

- Mock POI seam (mandatory): `vi.mock("@/lib/places/poi-client")` injecting
  the spec-0007 `POISearchResponse` shape (`place_id: ChIJ…`, `source:
  "google"`, `types` containing `cafe`, `business_status: "OPERATIONAL"`,
  serialized `hours_json`, non-empty `photo_refs`, ISO `fetched_at`). The POI
  client has no mock mode and 503s unconfigured — the suite never touches the
  network.
- Fake WebP: minimal valid `RIFF…WEBP` bytes. Real round-trip:
  `POST /api/images/upload { size }` → `{ imageUuid, uploadUrl,
  uploadHeaders, publicUrl, expiresAt }` → PUT bytes to the presigned MinIO
  URL. Creation then consumes the id via `checkin.photo_ids`. Preference
  order for the derivative-processing seam: real image-service worker when
  the gate provides it, otherwise a module mock of the image client seam
  only — the route handlers themselves are always the real ones. Full
  storage-failure matrices stay owned by `test:integration:images`.
- `POST /api/cafes` (auth required → anonymous 401 `unauthorized`; cross-site
  `Origin` → 403 `forbidden_origin`): body `{ name ≤200, lat, lng, address?,
  city?, google_place_id?, apple_poi_id?, opening_hours?, price_range 1–4?,
  checkin: { scores: { …0–100, overall required }, max_stay required
  (unlimited|3h|2h|1h|peak|unknown), note required ≤500, photo_ids required
  1–6 unique, visited_at? } }` → `201 { cafeId, checkinId, tz }`.
- Fused-transaction assertions: `tz` derived from coordinates (Cafe 1 →
  `Asia/Singapore`); gallery merged with `source: { type: "checkin", id }`;
  initial aggregate is exactly the creator's single contribution (Cafe 1:
  `experience_score 90`, `n_users 1`, `n_checkins 1`).
- Negative matrix (slice 2B owns the full grid; capstone spot-checks):
  missing `overall`, empty `note`, empty `photo_ids`, >6 or duplicate photo
  ids, score outside 0–100, `price_range` outside 1–4 → 400
  `invalid_request`; unknown/foreign/already-consumed photo id → 400
  `invalid_photos`; second create with the same `google_place_id` → 409
  `cafe_exists` carrying `cafe_id`; future `visited_at` → 400.
- Default anonymity (DG13, spec 0006): a fresh cafe's `GET /api/cafes/[id]`
  projects `author: null`, gallery images carry no `by`, and `maintainer` is
  null while creator-owned.

### 6. Path 3 — profile, settings, public identity

Citation correction (binding): public identity is spec 0006's 13 locked
decisions; DG128 is city resolution (§4). "DG08" for the self-like rule (§8)
is spec 0004 decision 8, per spec 0007 shorthand — the alignment ledger's DG8
entry is an unrelated cafe-actions ruling.

- `GET /api/profile` — anonymous → 401. Signed-in →
  `200 { profile: { id, displayName, avatarUrl, currentCity, createdAt,
  showPublicIdentity, publicHandle, identityConsentedAt,
  publicHandleChangedAt }, stats: { cafesCount, checkinsCount } }`. Defaults:
  `showPublicIdentity: false`, `publicHandle: null` — anonymity is the
  factory default, and `stats` move with lifecycle events (§10).
- `PATCH /api/profile` — `displayName` trims to 1–24 chars (400
  `display_name_length`), `currentCity` must be a DG50 launch city id
  (400 `invalid_current_city`), empty patch → 400 `empty_patch`.
- `PATCH /api/profile/identity` — `{ showPublicIdentity: true, publicHandle:
  "pioneer-a" }` opts A in with a deterministic user-chosen handle (regex
  `^[a-z0-9][a-z0-9_-]{2,29}$`, else 400 `invalid_handle`; omitted →
  auto-generated `slug(display_name)-xxxx`). The same read surfaces flip in
  one motion: `GET /api/cafes/[cafe1]` `author` and the Cafe 1 feed `author`
  go `null → { handle, display_name, avatar_url }`. Opt-out
  (`showPublicIdentity: false`) restores `author: null` everywhere with rows
  intact (read-time projection, no rewrite). The released handle stays
  reserved: C adopting `pioneer-a` → 409 `handle_taken`. A user-chosen handle
  change inside the 7-day cooldown → 400 `handle_change_too_soon` (slice 2C
  owns the cooldown matrix; the capstone asserts only the projection flips).

### 7. Path 4 — multi-user check-ins, 24h revisit, idempotency

- `POST /api/checkins` (auth required): `{ cafe_id, scores ≥1 dim 0–100,
  max_stay?, note? ≤500, photo_ids? ≤6, visited_at?, idempotency_key? UUID
  v4 }` → `201 { checkinId }`. Unknown/soft-deleted cafe → 404.
- Weighted recompute is asserted through User D's reads, never through DB:
  each (user, cafe) pair contributes exactly one vote per dimension to
  `work_stats` (§10 ledger).
- DG64 revisit: B's second `POST /api/checkins` at Cafe 1 inside the 24h
  window → `409 { error: "duplicate_checkin", existing_checkin_id }`. The
  real client flow is then asserted end-to-end: `GET
  /api/checkins/last?cafe_id=` → `{ checkin, revisitWindowHours: 24 }` →
  `PATCH /api/checkins/[id]` (B's overall 60 → 70, note replaced;
  `max_stay: null` clears) → `200 { cafeId }`; exactly one live row remains
  and the aggregate moves (experience 75 → 78.33). Non-author PATCH → 403
  `forbidden`.
- Window boundary (slice 2D): a first check-in backdated `visited_at =
  now-25h` (overall 60) makes the second POST (overall 80, `visited_at` now)
  a NEW check-in (201), and the user's contribution becomes the
  recency-weighted mean (decay 0.6, newest rank weight 1): (80×1 + 60×0.6) /
  1.6 = 72.5, collapsing to one cafe-level vote.
- DG61 idempotency: C's Cafe 2 check-in POSTed twice with the same
  `idempotency_key` → first 201, second `200 { checkinId }` with the SAME id
  and zero new rows (feed count unchanged). Replay is checked before the
  revisit window, so a replayed key inside 24h returns 200, never 409 —
  this precedence is asserted explicitly. Non-UUID key → 400.
- Feed (`GET /api/cafes/[id]/checkins`): `mode=newest` (default, DG113)
  orders `visited_at` desc; `mode=helpful` orders `likes_count` desc;
  unknown mode → 400 listing valid modes; `nextCursor` keyset-pages (one
  cursor hop asserted; deep paging stays in `tests/feed-cursor.test.ts`); a
  cursor from the other mode → 400, never a silent reset. Items expose
  `likes_count`, `liked_by_viewer` (false for anonymous D, true only for the
  liker), and `photos` without `by` (DG13).

### 8. Path 5 — social likes and the constraint line

- `POST /api/checkins/[id]/like` is a toggle (there is no DELETE): A likes
  B's check-in → `200 { liked: true, likesCount: 1 }`; again →
  `{ liked: false, likesCount: 0 }`; A re-likes and C likes →
  `likesCount: 2`, and helpful mode puts B's check-in first.
- Self-like → 403 `self_like_forbidden` (spec 0004 decision 8, "DG08" per
  spec 0007 usage) — A liking A's own creation check-in is rejected at the
  route, backstopped by the migration-0008 trigger.
- Anonymous like → 401; unknown check-in → 404. `liked_by_viewer` isolation:
  after A and C like, D (authed) still sees `liked_by_viewer: false`.

### 9. Path 6 — cafe lifecycle, deletion safety, community handoff (DG146)

- Authorization line: anonymous DELETE → 401; non-creator (B deleting Cafe 3)
  → 403 `forbidden`.
- Sole-owner shell: C deletes Cafe 3 → `200 { ok, id, removed_checkins: 1,
  owner_transferred: false, shell: true }`. The cafe row is never hard-deleted
  (DG146): `GET /api/cafes/[cafe3]` still 200s with `n_checkins: 0` and an
  empty feed, remains listed in `GET /api/cafes` as a public empty shell, and C's photos are stripped from the gallery. C's
  `GET /api/profile/checkins` no longer lists the check-in.
- Community cafe: A's bare `DELETE /api/cafes/[cafe1]` → 403
  `{ error: "cafe_has_other_checkins", code: "cafe_has_other_checkins",
  n: 2 }`; with `{ confirm: true }` → `200 { owner_transferred: true,
  removed_checkins: 1, shell: false }`. Afterwards: `created_by` is the
  service account; detail projects `author: null` plus `maintainer: "由
  CoffeeMode 维护"`; the feed retains only B's and C's check-ins; aggregates
  recompute without A (experience 72.5, composite 67.5, `n_users 2`); A's
  repeat DELETE → 403 (no longer creator). User D re-runs the §10 ledger
  against the post-deletion state.

### 10. Reconciliation ledger (User D's expected values)

All values derive from the fixed input matrix; assertions use exact equality
or `toBeCloseTo(..., 2)` for floats. Composite weights: wifi .30, outlets
.20, seats .20, temp .15, coffee .15 (`stats.dimWeights`).

| Actor → Cafe | wifi | outlets | seats | temp | coffee | overall | max_stay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A → Cafe 1 (creation) | 90 | 80 | 70 | 60 | 95 | 90 | unlimited |
| B → Cafe 1 | 60 | 60 | 60 | 60 | 60 | 60 → **70** (Act 4 edit) | 3h |
| C → Cafe 1 | 75 | 75 | 75 | 75 | 75 | 75 | 2h |
| B → Cafe 2 (creation) | — | — | — | — | — | 85 | 3h |
| A → Cafe 2 | — | — | — | — | — | 88 | 3h |
| C → Cafe 2 (DG61 pair) | — | — | — | — | — | 92 | 2h |
| C → Cafe 3 (creation) | — | — | — | — | — | 40 | unknown |

| Checkpoint | Cafe 1 | Cafe 2 | Cafe 3 |
| --- | --- | --- | --- |
| After Act 3 | `experience 75`, `composite 71.75`, `n_users 3`, `n_checkins 3`, policies `{unlimited:1, 3h:1, 2h:1}` | `experience 88.33`, `n_checkins 3` (DG61 pair = one row) | `experience 40`, `n_users 1` |
| After Act 4 (B edit) | `experience 78.33`, composite unchanged `71.75` | — | — |
| After Act 7 (likes) | B's check-in `likes_count 2`, helpful-first | — | — |
| After Act 8 (deletions) | `experience 72.5`, `composite 67.5`, `n_users 2`, `n_checkins 2`, maintainer branded | unchanged | shell: `n_checkins 0`, still listed |

Geo truth table (D at 1.3521, 103.8198): Cafe 1 present in the 10 km list,
closest-first; Cafe 2/3 excluded by distance (Tokyo/London). Slice 2A adds
the radius boundary pair (≈9.5 km included vs ≈12 km excluded even at
`radius_km=50`). City switch: `city=tokyo` → Cafe 2; `city=london` → Cafe 3
(pre-deletion, and as a shell post-deletion).

### 11. Request/session mechanics and cross-cutting contracts

- Mutating calls send `Origin: http://localhost:3000` (real browser posture)
  and `Content-Type: application/json`; each slice also proves one cross-site
  `Origin: https://evil.example` → 403 `forbidden_origin`. Bodyless-Origin
  non-browser clients are allowed by `requireSameOrigin` — the suite still
  always sends Origin to simulate the real client.
- Anonymous = no session. All write routes → 401 `unauthorized`; all reads
  listed above stay open with anonymous-safe projections.
- Error envelope is always `{ error, message?, ...extra }` with the exact
  status; every negative assertion checks BOTH status and `error` code.
- Rate limiting is a non-goal for this suite (owned by
  `tests/rate-limit.test.ts`); the harness resets buckets between Acts (§1).
- `GET /api/health` → `200 { ok: true, ... }` is the suite's liveness smoke.

### 12. Legacy test prune list

Prune rule (carried from spec 0007 §9): nothing is removed until the HTTP
suite is green on `main` for one full CI cycle; removals delete fully
duplicated `it` blocks, never whole files blindly. Stage 3 (BRAWUKA-150)
executes the audit against this list:

| Legacy target | HTTP-suite coverage | Action after green | Keep for |
| --- | --- | --- | --- |
| `tests/integration/user-journey.integration.test.ts` | Paths 1–6 re-covered by the two 0007 split suites AND this HTTP suite | delete file (pure duplication) | — |
| `tests/cafes.test.ts` | fused create, nearby list, detail, delete handoff | delete mocked happy-path blocks (`createCafeWithFirstCheckIn` mock-tx, `listCafesNearby` mocked-SQL, mocked delete happy path) | parser matrices, 400/401/403/409/429 route-shell edges, photo-intent race/dupe errors, visibility PATCH |
| `tests/checkins.test.ts` | create, DG64 409, DG61 replay, like toggle | delete mocked `createCheckIn` happy path and `toggleCheckInLike` echo blocks | invalid-payload matrices, error-mapping edges |
| `tests/checkins-last.test.ts` | `/api/checkins/last` happy path | delete mocked happy-path blocks | 400/401 validation edges |
| `tests/db/profile.test.ts` | profile read/write, both paginations | delete mocked-pool happy-path blocks | cursor encoding edges |
| `tests/identity.test.ts`, `tests/profile/identity-route.test.ts` | opt-in/out projection, handle taken | keep pure-logic units (regex, slug, cooldown); prune only mock-route happy-path duplication | cooldown/regex/rate-limit edges |
| `tests/integration/db.integration.test.ts` | — | keep intact (canonical SQL semantics: triggers 0004/0008, migrations, concurrency the HTTP layer cannot reach) | — |
| `tests/feed-cursor.test.ts`, `tests/stats/*`, `tests/search/*` (non-route), component/auth/helper suites | — | keep intact (codec edges, pure math, UI) | — |

Deleting `tests/integration/user-journey.integration.test.ts` lands in the
same change as a spec 0007 §1 amendment retiring its "proving file" line —
the two 0007 split suites remain the service-layer proof.

### 13. Stage 2 implementation slicing (BRAWUKA-146)

Stage 2 is re-architected from one monolithic issue into four depth slices
plus the existing issue refocused as the capstone. Every slice is a separate
`web/tests/integration/http-*.integration.test.ts` file that bootstraps its
own fixtures through HTTP only — no cross-file state, no shared mutable
fixtures — so slices are independent and parallel-safe. Slices own the edge
matrices; the capstone owns the causal timeline (Acts 0–8) and must NOT
duplicate slice edge grids.

| Slice | Issue | File | Owns |
| --- | --- | --- | --- |
| 2A | HTTP-TEST-2A | `http-discovery-filters.integration.test.ts` | Path 1: `/api/cafes` geo matrix (radius clamp, ordering, empty 200, anonymous visibility), `/api/search` city switch + DG128 chain + 400 unknown city, min-score filters, deterministic `open_now` trio, `filter_max_stay` ordinal, weak-results兜底, response headers |
| 2B | HTTP-TEST-2B | `http-cafe-creation-media.integration.test.ts` | Path 2: mock POI inject, fake WebP presign → PUT → fused create, 201 contract + tz + initial aggregate + default anonymity, full 400/409 negative matrix, `cafe_exists` dedupe, photo-intent misuse (`invalid_photos`) |
| 2C | HTTP-TEST-2C | `http-profile-identity.integration.test.ts` | Path 3: profile 401/read/write validation grid, default anonymity, identity opt-in (explicit + auto-generated handle), projection flips on detail + feed, opt-out losslessness, `handle_taken`, `handle_change_too_soon` cooldown, stats counters |
| 2D | HTTP-TEST-2D | `http-checkins-social.integration.test.ts` | Paths 4+5: check-in create contract, DG64 409 → `checkins/last` → PATCH edit flow, 25h window-expiry second check-in + 0.6-decay contribution math, DG61 replay precedence over revisit, feed newest/helpful/cursor-hop/cross-mode-400, like toggle symmetry, self-like 403, anon 401 |
| Capstone | BRAWUKA-149 (refocused) | `http-user-lifecycle.integration.test.ts` | The composed Acts 0–8 timeline across all six paths, the §10 reconciliation ledger, and Path 6 deletion/handoff with User D's post-deletion re-reconciliation |

Sequencing: slices land first (any order), capstone lands last — it is the
suite that turns individual path contracts into one lifecycle story. Stage 3
(BRAWUKA-150) then wires `npm run test:integration:http` and executes §12.

### 14. Path I/O matrix (HTTP boundary)

| Path | Endpoint(s) | Input | Output | Boundary assertion | Mock seam |
| --- | --- | --- | --- | --- | --- |
| 1 discovery | `GET /api/cafes`, `GET /api/search` | lat/lng/radius/limit; city, q, filter_*, open_now | ordered `CafeSummary[]`; scoped `SearchResultItem[]` + reference_point | 12 km cafe excluded even at `radius_km=50`; unknown city → 400; closed/unknown-hours cafes excluded by `open_now` | none (real PostGIS) |
| 2 creation | `POST /api/images/upload`, `POST /api/cafes` | fused body + fake WebP via presigned PUT | `201 { cafeId, checkinId, tz }`, gallery merged, initial aggregate | 401 anon; 403 cross-origin; 409 `cafe_exists`; `author: null` | `poi-client` module mock (mandatory); image worker real-or-seam-mocked per §5 |
| 3 identity | `GET/PATCH /api/profile`, `PATCH /api/profile/identity` | displayName/city; showPublicIdentity ± handle | profile DTO; `author` flips `null ↔ handle` on all public surfaces | opt-out restores `null` rows-intact; released handle → 409 `handle_taken` | `getCurrentUser` session seam (harness) |
| 4 check-ins | `POST /api/checkins`, `GET /api/checkins/last`, `PATCH /api/checkins/[id]`, `GET /api/cafes/[id]/checkins` | scores/max_stay/note/visited_at/idempotency_key | 201/200 replay; 409 + `existing_checkin_id`; feed pages | replay-before-revisit precedence; 25h boundary new row; cross-mode cursor → 400 | none |
| 5 likes | `POST /api/checkins/[id]/like` | toggle POST | `{ liked, likesCount }` | self-like → 403 `self_like_forbidden`; anon → 401; viewer isolation | none (real trigger) |
| 6 lifecycle | `DELETE /api/cafes/[id]` | `{ confirm? }` | shell vs handoff payload | bare community delete → 403 `cafe_has_other_checkins` n=2; post-handoff repeat → 403; shell still listed | none |

## Data/API/UI behavior when relevant

- Aggregate math is the spec-0007 two-tier model: per-user recency-weighted
  contribution (decay 0.6) collapses to one vote per user per dimension;
  `experience_score` = mean of per-user overall contributions;
  `composite_score` = weighted dim mean over wifi/outlets/seats/temp/coffee.
  The §10 ledger is the worked example; edits move `experience_score` without
  touching `composite_score` when only `overall` changed (Act 4).
- All distances come from PostGIS (`distance_m`), never computed in-test;
  ordering assertions, not meter-exact thresholds.
- Public surfaces never expose `created_by` or image `by` (DG13); the
  service-account maintainer string `由 CoffeeMode 维护` is the only owner
  signal a handoff cafe shows.
- This suite asserts API truth only; no UI rendering is in scope.

## Edge cases

1. Radius boundary: ≈9.5 km in vs ≈12 km out — containment, not meter
   equality (PostGIS spheroid noise), and the clamp proof uses
   `radius_km=50`.
2. `open_now` determinism comes from fixture hours (always-open / explicit
   closed days / unknown), never from wall-clock or server time injection.
3. DG64 × DG61 precedence: a replayed idempotency key inside the 24h window
   returns 200 with the original id — the revisit 409 must NOT fire first.
4. Cross-mode feed cursor → 400 `invalid_request`; a silent reset would be a
   product bug, not a convenience.
5. A consumed photo intent cannot be reused (400 `invalid_photos`), so a
   DG61 retry can never double-attach gallery images.
6. Identity CDN staleness (`s-maxage 600`, spec 0006 Q6) is a read-path CDN
   property — unassertable at the HTTP route layer, excluded by design.
7. Like races: sequential toggle symmetry only; true concurrency belongs to a
   load test, not Vitest.
8. Rate-limit 429 behavior is owned by `tests/rate-limit.test.ts`; this suite
   resets buckets between Acts and never asserts 429.
9. Grandfathered hard tombstones (pre-DG146) stay 404 — covered by the
   service-layer suite, out of scope here; the HTTP suite asserts the DG146
   empty-shell semantics only.
10. DG126 max-stay re-bucketing is PROPOSED, not decided — no assertion may
    reference the new buckets.

## Tests / acceptance criteria

- Each slice file and the capstone pass under
  `RUN_INTEGRATION=1 npx vitest run tests/integration/<file>` against
  `docker compose up -d --wait postgres` + MinIO (CI `integration-gate`).
- Every `it` block names its Path (1–6) and spec/DG code where applicable, so
  failures point at the product contract, not the test file.
- `npm run typecheck`, `npm run lint`, and `.agents/scripts/preflight.sh`
  pass on the new files; `npm run test` stays green without the gate.
- Any implementation deviation discovered by the suite is filed as a bug
  issue and the assertion stands — weakening an assertion to fit the code is
  a process violation.
- Stage 2 is complete when slices 2A–2D and the capstone are all green, and
  Stage 3 may begin the §12 prune only after one full green CI cycle on
  `main`.
