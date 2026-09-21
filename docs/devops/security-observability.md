# Security Observability Runbook

Baseline procedure for watching the Cloudflare edge once `cafemood.app` is
proxied (BRAWUKA-235, derived from BRAWUKA-233 P1). Lives next to
`LIFECYCLE.md`; nothing here requires paid tooling.

## Cadence

| Window | Frequency | Why |
|---|---|---|
| Launch week 1 (Bot Fight Mode false-positive window) | Daily | BFM can challenge legitimate API/native clients; catch it before users do |
| Steady state | Weekly | Trend 429/Challenge ratios, scanner noise, rule hit distribution |

## Checklist — Security → Events / Analytics

1. **429 / Challenge ratio**: Security → Events, filter `action = block` vs
   `action = challenge` over the window. A challenge rate far above block rate
   on `/api/*` GETs suggests BFM or the suspicious-UA rule is catching real
   clients — cross-check Top UA before tuning.
2. **Top ASN / UA**: Security → Analytics → top source ASNs and user agents.
   Expected baseline: consumer ISPs (Singtel/StarHub/M1 for SG traffic),
   browser UAs, `cafemood-smoke/1.0` (deploy smoke tests, exempted from the
   UA rule per BRAWUKA-237). Flag: hosting ASNs (Hetzner/DO/OVH/Alibaba),
   empty UA, `python-requests`/`scrapy`/`curl/` volume beyond smoke tests.
3. **Rule hit distribution**: which managed/custom rule produces the most
   actions. A single rule dominating = either an active scan (fine, it is
   working) or a mis-scoped rule (tune). Zero hits on the scanner-noise rule
   for a full week is normal.
4. **Rate-limit rule**: the free-tier edge rule (`/api/*`, 300 req/min/IP,
   10-min block) should rarely fire — app-level buckets trip first. If it
   fires often, an IP is flooding; consider whether app buckets are too loose.

## Checklist — Application layer

- `rate-limit-alert` hook (DG129, `web/lib/observability/rate-limit-alert.ts`)
  emits a throttled `console.warn` always, and POSTs to the per-environment
  Better Stack HTTP source when `BETTER_STACK_INGEST_URL` (source host) is set
  on the app container, authenticating with `Authorization: Bearer
  BETTER_STACK_INGEST_TOKEN`. Staging posts to `coffeemode-rate-limit-staging`,
  prod to `coffeemode-rate-limit-prod` — separate sources so env filtering is
  structural. Both vars are server-only (spec 0010). One event shape
  (BRAWUKA-378 removed the `fail_open` path with the Postgres backend):
  - `rate_limited` (level `warn`) — a bucket denied a request.
- In Better Stack, create an alert on each ingest source:
  `event:rate_limited` → low-severity notification.
  The event carries `bucket`, `client_id`, `window_ms`, `max_requests`,
  `retry_after`, `route`. Verified 2026-09-17: synthetic `rate_limited`
  events round-tripped on both sources (ingest 202 → query-visible within
  ~1 min). If a legacy `rate_limiter_fail_open` alert still exists from
  before BRAWUKA-378, delete it — that event can no longer fire.
- `api-error-sink` hook (spec 0011 D8, `web/lib/observability/api-error-sink.ts`)
  ships every `logError`/`logWarn` JSON line to the per-environment
  `coffeemode-api-errors` source when `BETTER_STACK_ERRORS_INGEST_URL` (source
  host) is set on the app container, authenticating with `Authorization: Bearer
  BETTER_STACK_ERRORS_INGEST_TOKEN`. Staging posts to
  `coffeemode-api-errors-staging`, prod to `coffeemode-api-errors-prod` — same
  structural env split as the rate-limit pair, both vars server-only (spec
  0010). The proxy's `type:"access"` lines are deliberately NOT shipped: the
  proxy runs before routing, so its response is always the 200
  `NextResponse.next()` and it never sees the route's status or envelope
  `code` (verified against a running dev server — a 404 page logs
  `"status":200`). The error lines carry the real `status` and `code`, so they
  are the metric source. Verified 2026-09-21: synthetic `internal_error` lines
  round-tripped on both sources (ingest 202 → query-visible within ~1 min).
- Better Stack `CoffeeMode API Errors (staging)` / `(prod)` dashboards (team
  `Your team`, group `CoffeeMode API Errors`): 5xx by `route`, error-`code`
  histogram, worker `upstream_error` count, plus 429 by `bucket` from the
  matching rate-limit source. Two chart alerts per dashboard: *5xx sustained on
  a route* and *Worker `upstream_error` spike* — both "any breach in a 60 s
  bucket, sustained 5 min, auto-resolve after 5 min", one incident per series.
  Verified 2026-09-21: a synthetic `internal_error` stream on staging produced
  an incident on the staging 5xx alert.
- **One source per dashboard — a chart alert cannot resolve a source
  variable.** `create_chart_alert` binds the alert to the chart's source at
  creation. If the dashboard's `source` variable was written with
  `set_dashboard_variable`, the alert silently binds to the team's *default*
  source instead (observed: `source:onboarding_real_time_flights:logs`) and
  never fires on this data. Set the dashboard's source only through
  `create_dashboard(source_id: …)` and let the chart save auto-create the
  variable; extra *custom-named* source variables (`rate_limit_source`) and
  sections are fine. If an alert's `Source Variable` line does not name the
  expected `coffeemode-*` source, delete and recreate it.
- **Known coverage gap**: the dashboards count 5xx that emitted an error/warn
  line. A handler that *returns* a 5xx envelope without logging — today only
  `GET /api/mapkit-token` (`mapkit_token_error`) — is not counted. The
  `apiRoute` catch-all path always logs, so unexpected throws are covered.
- Workers Observability: `poi-service-prod` / `image-service-prod` logs for
  shared-secret rejections (401s on `x-poi-service-token` /
  `x-image-service-token`) — any volume means someone is probing the worker
  endpoints directly.

## Checklist — API Shield Discovery (after BRAWUKA-237 enables it)

Compare discovered endpoints against the expected anonymous-readable surface:

- `GET /api/cafes`, `GET /api/cafes/[id]`, `GET /api/cafes/[id]/checkins`,
  `GET /api/cafes/[id]/recovery`, `GET /api/search`,
  `GET /api/places/search`, `GET /api/mapkit-token`,
  `POST /api/places/resolve` (anonymous POST by design).

Any discovered endpoint outside this list plus the authenticated routes is
unexpected — check whether it is a stale route, a scanner artifact, or a real
exposure gap.

## Escalation

- BFM false positive on a real client path → add a WAF Skip rule for that
  path (free tier: 5 custom rules total, budget carefully).
- Sustained flood beyond the edge rule → tighten the edge rule window or add
  an ASN/UA block; do not loosen app buckets.
