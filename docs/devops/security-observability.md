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
  emits one structured `logWarn` line per bucket denial, unthrottled, plus a
  throttled `console.warn` for local noise reduction. The line is the complete
  record (ADR-0004) and `otlp-logs.ts` ships it to Grafana Cloud Loki over
  OTLP. The Better Stack POST and its `BETTER_STACK_INGEST_*` pair were retired
  2026-09-21 (BRAWUKA-605 §6 decision 1: direct cutover, no dual-run). One event
  shape (BRAWUKA-378 removed the `fail_open` path with the Postgres backend):
  - `rate_limited` (level `warn`) — a bucket denied a request.
- Alert on it in Grafana Cloud, not Better Stack:
  `{service_name="coffeemode-web"} | severity_text="WARN" | code="rate_limited"`
  → low-severity notification. The line carries `bucket`, `client_id`,
  `client_ip`, `retry_after`, `route`, `status`, `code`. `client_ip` is the raw
  `cf-connecting-ip` behind the denial, kept for abuse investigation (BRAWUKA-605
  §6 decision 5); it rides a log-record attribute, so it lands in structured
  metadata and never becomes a label. If a legacy `rate_limiter_fail_open` alert
  still exists from before BRAWUKA-378, delete it — that event can no longer
  fire.
- `otlp-logs` hook (BRAWUKA-607, `web/lib/observability/otlp-logs.ts`) ships
  every `logError`/`logWarn` JSON line — and the proxy's `type:"access"` line —
  to Grafana Cloud Loki over OTLP, on the same SDK and endpoint as traces
  (`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`, BRAWUKA-606).
  It replaced the Better Stack `api-error-sink` (spec 0011 D8, BRAWUKA-541) and
  the `BETTER_STACK_ERRORS_INGEST_*` pair, which are gone. Unset endpoint means
  no SDK and no export attempts, so local dev and CI stay stdout-only.
  Because the line is emitted inside the request's span, it carries `trace_id` /
  `span_id` and clicks through to its Tempo trace — the reason the Alloy stdout
  collector was dropped (docs/devops/grafana-cloud-adoption.md §3 P0-1).
  The proxy's access line records the request, not an outcome: the proxy runs
  before routing, so its response is always the 200 `NextResponse.next()` and it
  never sees the route's status or envelope `code` (verified against a running
  dev server — a 404 page logs `"status":200`). The error lines carry the real
  `status` and `code`, so they remain the metric source.
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
