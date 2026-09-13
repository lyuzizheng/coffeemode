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
| `search.open_now.batches` | int ≥ 0 | Iterative-fetch batches consumed; `0` when `open_now` is inactive (SQL pushdown path). `>0` identifies `open_now` requests. |
| `open_now_truncated` | bool, present only when true | `open_now` filter still under-matched after `maxIterativeFetchBatches` (10) — the DG145-B trigger condition. |
| `search.poi_degraded` | bool | Stored-POI or live-POI upstream failed; response carried `warnings: ["poi_unavailable" \| "live_poi_unavailable"]` (DG133). |

Derived ratios (all over a rolling 7-day window unless stated):

- `truncation_rate` = count(`search.truncated=true`) / count(`search.requests`).
- `open_now_share` = count(`search.open_now.batches > 0`) / count(`search.requests`).
- `open_now_p95` = p95(`search.duration_ms`) over `open_now.batches > 0`.
- `poi_degraded_rate` = count(`search.poi_degraded=true`) / count(`search.requests`).
- `live_share` = count(`mode=live`) / count(`search.requests`) — billed-fanout watch.

### Collection path

`search.telemetry` lines go to container stdout → Better Stack Logs via the
VPS log shipper (Vector or the Better Stack Docker collector; choice is an
implementation detail). Metrics are extracted in Better Stack from the JSON
fields — **no separate metrics pipeline is introduced** (Critical Cleanup
Gate: no second consumer exists). No client-side analytics in MVP.

Bounds: fields are frozen — adding, renaming, or re-typing a field requires
amending this ADR. Telemetry MUST NOT carry `q`, coordinates, `viewer_id`, or
any user content; the five fields plus `open_now_truncated` are the complete
set. Volume ≈ 1 line/request ≈ 200 B; at 1 rps sustained ≈ 17 MB/day — inside
the Better Stack free tier (3 GB/mo, 3-day retention). The 7-day rolling
windows above are evaluated from whatever retention the plan provides; if
retention < 7 days, evaluate on the largest available window and note it in
the promotion evidence.

### Alerts (Better Stack)

| Alert | Condition | Window |
| --- | --- | --- |
| `open_now` truncation fired | any `open_now_truncated=true` event | per event |
| POI degradation | `poi_degraded_rate` > 5% with ≥ 20 requests | 24 h |
| Search latency regression | p95(`search.duration_ms`) > 400 ms | 24 h, ≥ 50 requests |

### Dashboard

One "Search" dashboard, four panels: request volume by `mode`;
`duration_ms` p50/p95 overall and `open_now`-only; `truncation_rate` +
`open_now.batches` histogram + `open_now_truncated` count;
`poi_degraded_rate` + `live_share`.

### Stage 3 promotion criteria (verbatim contract for #293)

- **DG145-C** (`open_now` SQL pushdown, migration 0016): promote when
  `open_now_share > 15%` AND `open_now_p95 > 400 ms` over a rolling 7-day
  window, OR any `open_now_truncated=true` event is observed (the latter also
  authorizes the DG145-B interim: 300 ms budget + `open_now_truncated`
  warning).
- **DG137-C** (edge cache `city:q:filtersHash` 60 s): promote when
  `search.requests` sustains ≥ 0.5 rps over a rolling 7-day window — the
  point where a 60 s cache eliminates meaningful Postgres QPS. A true
  server-side hit-ratio field (`search.cache`) is added with the edge-cache
  change itself, not before.
- **DG135-C** (result view widened to 50): promote when `truncation_rate`
  > 20% over a rolling 7-day window.

## Consequences

- Stage 3 (#293) can quote the three promotion criteria verbatim; the
  evidence source is the Better Stack "Search" dashboard.
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
