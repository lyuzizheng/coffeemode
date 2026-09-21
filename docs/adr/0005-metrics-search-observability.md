# 0005. Search Observability — Metrics, Collection, and Promotion Thresholds

## Status

Accepted

## Context

The unified search surface (#135, grill `docs/agent/BRAWUKA-7-search-grill.md`
DG131–DG145) deferred its full observability design to this ADR (grill Q10/Q15
ruling). Stage 2 (#291) froze five telemetry fields emitted as one
`console.info("search.telemetry", …)` JSON line per `/api/search` request in
`web/lib/search/search-service.ts`, plus the `X-Search-Mode` response header
(DG132). Without defined metric 口径, collection path, and thresholds, the
Stage 3 promotion gates (#293: DG145-C `open_now` SQL pushdown, DG137-C edge
cache, DG135-C result-view widening) cannot be evaluated.

ADR-0004 recorded "no SaaS log service is wanted." DG129 (owner-approved)
supersedes that for a bounded scope: Better Stack is adopted for search
telemetry and rate-limit alerting only; the rest of the log surface stays
stdout + `request_id` correlation per ADR-0004. Account + source token are an
owner action (`docs/agent/pending-user-actions.md` §7).

## Decision

### Metric 口径 (frozen fields, emitted per request)

| Field | Type | Semantics |
| --- | --- | --- |
| `search.requests` | `{ mode: "stored_only" \| "live" }` | One event per `/api/search` execution. `mode=live` iff the billed Google live fanout ran (`include_live=true` and `q` ≥ `minPoiQueryLength`); `stored_only` otherwise. Mirrors `X-Search-Mode`. |
| `search.duration_ms` | int ms | Wall time of `executeSearch` (DB + POI fanout + ranking), `performance.now()` delta, rounded. |
| `search.truncated` | bool | `total_count > results.length` — the response hit the top-10 cap (DG46) after relevance truncation (DG131). |
| `search.open_now.batches` | int ≥ 0 | **Always 0** since DG145-C shipped (BRAWUKA-25): `open_now` is a SQL predicate (`cafe_is_open_at`, migration 0028), so the iterative-fetch counter it measured no longer exists. Kept in the event so the field contract stays stable; the `open_now_share` derivation below is dead. |
| `search.poi_degraded` | bool | Stored-POI or live-POI upstream failed; response carried `warnings: ["poi_unavailable" \| "live_poi_unavailable"]` (DG133). |
| `search.cache` | `"hit" \| "miss" \| "bypass"` | Edge-cache outcome for the request (DG137-C, added with the cache itself per this ADR's pre-authorization). `hit` = served from the in-process cache; `miss` = executed and stored; `bypass` = cache not consulted (SSR page, or the cafes data-version read failed). |

Derived ratios (all over a rolling 7-day window unless stated):

- `truncation_rate` = count(`search.truncated=true`) / count(`search.requests`).
- `open_now_share` / `open_now_p95` — **dead** (BRAWUKA-25): `search.open_now.batches` is always 0 post-pushdown, so no request is identifiable as open_now-filtered from telemetry.
- `poi_degraded_rate` = count(`search.poi_degraded=true`) / count(`search.requests`).
- `live_share` = count(`mode=live`) / count(`search.requests`) — billed-fanout watch.
- `cache_hit_rate` = count(`search.cache=hit`) / count(`search.cache` ∈ {hit, miss}) — DG137-C effectiveness watch.

### Collection path

`search.telemetry` lines go to container stdout → Better Stack Logs via the
VPS log shipper (Vector or the Better Stack Docker collector; choice is an
implementation detail). Metrics are extracted in Better Stack from the JSON
fields — **no separate metrics pipeline is introduced** (Critical Cleanup
Gate: no second consumer exists). No client-side analytics in MVP.

Bounds: fields are frozen — adding, renaming, or re-typing a field requires
amending this ADR. Telemetry MUST NOT carry `q`, coordinates, `viewer_id`, or
any user content; the fields above are the complete set (`open_now_truncated`
was retired with the iterative fetch in BRAWUKA-25; `search.cache` was added
with the edge cache per the pre-authorization below). Volume ≈ 1 line/request
≈ 200 B; at 1 rps sustained ≈ 17 MB/day — inside
the Better Stack free tier (3 GB/mo, 3-day retention). The 7-day rolling
windows above are evaluated from whatever retention the plan provides; if
retention < 7 days, evaluate on the largest available window and note it in
the promotion evidence.

### Alerts (Better Stack)

| Alert | Condition | Window |
| --- | --- | --- |
| POI degradation | `poi_degraded_rate` > 5% with ≥ 20 requests | 24 h |
| Search latency regression | p95(`search.duration_ms`) > 400 ms | 24 h, ≥ 50 requests |
| Edge-cache dead | `cache_hit_rate` = 0 with ≥ 50 misses | 24 h |

### Dashboard

One "Search" dashboard, four panels: request volume by `mode`;
`duration_ms` p50/p95; `truncation_rate` + `search.cache` hit/miss split;
`poi_degraded_rate` + `live_share`.

### Stage 3 acceptance (superseded by owner ruling, 2026-09-13)

The telemetry-based promotion criteria below were written when production
traffic was assumed. The app never deployed to production, so the owner
ruled that **staging end-to-end verification is the acceptance gate** for
#293 (BRAWUKA-25): real-Postgres parity between `cafe_is_open_at` and
`isOpenAt`, HTTP-level cache hit/invalidation proof, and a green
`run-staging-journey.sh --suite all`. The criteria are kept here as the
historical record of the original contract.

- **DG145-C** (`open_now` SQL pushdown): originally gated on
  `open_now_share > 15%` AND `open_now_p95 > 400 ms` over a rolling 7-day
  window, OR any `open_now_truncated=true` event. Shipped as a STABLE
  plpgsql function (`cafe_is_open_at`, migration 0028) — the grill's
  `tsrange[]`+GIST sketch was dropped because a `now()`-dependent predicate
  cannot be indexed.
- **DG137-C** (edge cache `city:q:filtersHash` 60 s): originally gated on
  `search.requests` ≥ 0.5 rps over 7 days. Shipped as an in-process Map
  (single VPS) with `cafes.updated_at` version invalidation; `search.cache`
  hit/miss/bypass is emitted per request.
- **DG135-C** (result view widened to 50): unchanged — promote when
  `truncation_rate` > 20% over a rolling 7-day window.

## Consequences

- Stage 3 (#293) shipped under the owner-ruled staging-E2E gate above; the
  Better Stack "Search" dashboard remains the evidence source once traffic
  exists.
- ADR-0004's "no SaaS log service" is superseded only for this bounded scope;
  access/error log correlation stays on `request_id` and stdout.
- The frozen-field contract makes telemetry a tested surface
  (`web/tests/search/search-service.test.ts` asserts the shape); a field
  change without an ADR amendment is a contract break.
- Better Stack account + token remain owner actions
  (`docs/agent/pending-user-actions.md` §7); until provisioned, the same
  fields are greppable from container stdout, so Stage 3 evidence can be
  collected manually at current volume.
- If search volume outgrows the free tier, the fix is sampling or a paid
  plan — a new decision, not a silent pipeline change.
