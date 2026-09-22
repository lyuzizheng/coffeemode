# 0007. Sitemap Query — Full Scan Accepted Until Sharding Threshold

## Status

Accepted

## Context

BRAWUKA-648 (split out of the AUDIT-S3 performance list, parent BRAWUKA-415)
flagged `listCafeSitemapEntries` (`web/lib/db/cafes/reads.ts`) as an unbounded
`SELECT` with a full-table sort:

```sql
select id,
       coalesce((work_stats->>'updated_at')::timestamptz, updated_at) as lastmod
from cafes
where deleted_at is null
  and visibility = 'public'
  and ((work_stats->>'n_checkins') is null or (work_stats->>'n_checkins')::int > 0)
order by lastmod desc
```

The query seq-scans `cafes`, filters to live public cafes with at least one
check-in, and sorts the survivors by `lastmod`. Its only caller is
`web/app/sitemap.ts` (`force-dynamic`), which emits one `<url>` per row — the
result set *is* the sitemap, so the row count cannot be reduced without
dropping canonical URLs from crawlers.

## Decision

Accept the sequential scan + in-memory sort as-is. No `LIMIT`, no expression
index, no sitemap sharding at current scale. Revisit when any trigger in
*Revisit triggers* fires.

Why each cheaper-looking alternative is rejected:

- **`LIMIT n`** — silently drops cafes from `sitemap.xml`. That is a
  correctness loss (canonical URLs become undiscoverable to crawlers), not a
  performance fix.
- **Expression index on `coalesce((work_stats->>'updated_at')::timestamptz,
  updated_at)`** — would replace the sort with an index walk, but the scan
  still visits every qualifying row (the response is the full set), and the
  index adds write amplification on every check-in-driven `work_stats`
  update. Paying write cost on the hot path to accelerate a read that runs
  at most once per cache window is the wrong trade at current size.
- **Sitemap index + shards** (`/sitemap/cafes/[shard].xml`) — the real fix
  past scale, but premature: Google caps a sitemap at 50,000 URLs / 50 MB,
  and the live public cafe count is orders of magnitude below that.

## Evidence the scan is bounded in practice

- **Origin hit rate is cache-bounded, not request-bounded.**
  `web/next.config.ts` stamps `Cache-Control: public, s-maxage=600,
  stale-while-revalidate=3600` on `/sitemap.xml` (DG105/DG107; TTLs owned by
  `seo.shellCache` in `web/config/app.yaml`). The CDN serves the cached body
  and revalidates in the background, so Postgres sees roughly one fresh
  execution per 10 minutes per edge POP, not one per crawler hit.
- **The filtered set is the small set.** `deleted_at is null`, public
  visibility (DG147), and `n_checkins > 0` (empty-shell exclusion, DG146)
  shrink the scanned rows to cafes that actually appear in the sitemap.
- **Sort cost is `O(N log N)` over that filtered set** — trivial until N is
  large; see triggers below for when "large" starts.

## Revisit triggers

Reopen this decision when any of the following holds:

- Live public cafes with check-ins approach **~10k rows** (sort memory and
  response size grow linearly), or the hard bound of **50k URLs** (Google's
  per-sitemap limit) comes into view — at that point sharding is mandatory,
  not optional.
- The sitemap query surfaces in `pg_stat_statements` / slow-query logs, or
  `work_stats` update frequency makes the expression index pay for itself.
- The edge cache on `/sitemap.xml` is removed or bypassed, so origin hit
  rate climbs toward per-request.

When revisiting: shard under a sitemap index (e.g. by `id` hash or `lastmod`
ranges into `/sitemap/cafes/[shard].xml`); add the functional partial index
only if the per-shard queries still sort meaningfully.

## Consequences

- BRAWUKA-648 closes as a documented accepted risk, not an unexamined one.
- Residual risk: a cache-miss burst (edge flush plus a crawler storm) runs
  one seq scan + sort per miss. Postgres absorbs it; the cache refills and
  the burst self-corrects. No correctness risk — the query is read-only and
  its output contract is unchanged.
- The `ORDER BY lastmod desc` stays: it is covered by integration tests and
  keeps the emitted sitemap deterministic.

## Related

- `docs/specs/0001-nextjs-migration.md` — DG105 (dynamic sitemap, lastmod
  from `work_stats.updated_at`), DG146/DG147 (shell + private exclusion)
- `web/app/sitemap.ts`, `web/lib/db/cafes/reads.ts` — the query and its caller
- `web/next.config.ts`, `web/config/app.yaml` — `/sitemap.xml` cache headers
- ADR-0006 (edge `x-forwarded-proto` trust, PR #601 pending merge) — same
  "written acceptance via ADR" pattern for AUDIT findings
- BRAWUKA-648 (this item), BRAWUKA-415 (AUDIT-S3 parent)
