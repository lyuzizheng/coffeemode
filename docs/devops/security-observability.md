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
  emits one unthrottled structured `logWarn` line per denial, plus a throttled
  (10 s) `console.warn` for local noise reduction. The line carries `bucket`,
  `client_id`, `client_ip`, `retry_after`, `route`, `status: 429` and
  `code: "rate_limited"`. One event shape (BRAWUKA-378 removed the `fail_open`
  path with the Postgres backend): `rate_limited` — a bucket denied a request.
  There is no second sink: the Better Stack POST that used to sit beside the
  log line was removed with Better Stack itself (BRAWUKA-611), so the log line
  is the only record and the only thing the alert rule reads.
- `otlp-logs` hook (BRAWUKA-607, `web/lib/observability/otlp-logs.ts`) ships
  every `logError`/`logWarn` JSON line — and the proxy's `type:"access"` line —
  to Grafana Cloud Loki over OTLP, on the same SDK and endpoint as traces
  (`OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS`, BRAWUKA-606).
  It replaced the retired `api-error-sink` hook (spec 0011 D8, BRAWUKA-541) and
  its ingest-credential pair, both of which are gone. Unset endpoint means
  no SDK and no export attempts, so local dev and CI stay stdout-only.
  Because the line is emitted inside the request's span, it carries `trace_id` /
  `span_id` and clicks through to its Tempo trace — the reason the Alloy stdout
  collector was dropped (docs/devops/grafana-cloud-adoption.md §3 P0-1).
  The proxy's access line records the request, not an outcome: the proxy runs
  before routing, so its response is always the 200 `NextResponse.next()` and it
  never sees the route's status or envelope `code` (verified against a running
  dev server — a 404 page logs `"status":200`). The error lines carry the real
  `status` and `code`, so they remain the metric source.
- **Loki label vocabulary** — Grafana Cloud promotes a fixed list of OTLP
  resource attributes to Loki index labels and puts everything else in
  structured metadata. The app's lines therefore index on exactly two labels,
  `service_name="coffeemode-web"` and `deployment_environment_name`
  (`staging` / `production`, from `OTEL_RESOURCE_ATTRIBUTES`), and every
  queryable field — `log_type`, `route`, `status`, `code`, `bucket`,
  `client_id`, `client_ip`, `request_id`, `retry_after` — is structured
  metadata, filtered with `| field="value"` and no `| json` parse. There is no
  `service` or `env` label; a query using them silently matches nothing.
- **Alert rules** (BRAWUKA-611, folder `CoffeeMode`) — six Grafana-managed
  rules, one per signal per environment, all LogQL over the two labels above:
  - `CoffeeMode — 5xx sustained on a route (prod|staging)` —
    `sum by (route) (count_over_time({…} | log_type="error" | status=~"5.." [1m])) > 5`, `for: 5m`.
  - `CoffeeMode — Worker upstream_error spike (prod|staging)` —
    `sum by (route) (count_over_time({…} | log_type="error" | code="upstream_error" [1m])) > 3`, `for: 5m`.
    Counts the web app's view of a failing Cloudflare Worker call; the Workers
    themselves log to Cloudflare, not to Loki.
  - `CoffeeMode — Rate-limit flood (prod|staging)` —
    `sum by (bucket) (count_over_time({…} | code="rate_limited" [1m])) > 50`, `for: 10m`.
  Each rule carries `env=prod|staging`, `severity` and `team=coffeemode`, and
  sets no per-rule receiver, so routing is decided in one place — the
  notification policy.
- **The notification path is not wired yet — and this is not hypothetical.** The
  stack has no contact point and the default policy receiver is the built-in
  no-op `empty`, so a firing rule notifies nobody. As of 2026-09-21 13:24 UTC
  the sibling uptime rule (`CoffeeMode — Uptime probe failing`, BRAWUKA-608)
  had been in `firing` for ~1.5 h on a genuine production outage —
  `cafemood.app` returns 502 (BRAWUKA-500) — and no one was paged.
  **The cause is not a missing permission.** `GET
  /api/access-control/user/permissions` lists every alternative the 403 names —
  `alert.notifications.provisioning:write`, `alert.notifications:write`,
  `alert.notifications.receivers:create`, `alert.notifications.routes:write`,
  `alert.provisioning.provenance:write` — yet all five write paths are refused:
  `POST /api/v1/provisioning/contact-points` and `PUT
  /api/v1/provisioning/policies` answer 403, the legacy
  `/api/alert-notifications` and `/api/alertmanager/grafana/config/api/v1/receivers`
  answer 404, and the k8s-style
  `/apis/notifications.alerting.grafana.app/.../receivers` answers 403
  `invalid namespace` for every namespace tried. The effective grant is
  narrower than the reported RBAC role — most likely the hosted MCP server's
  OAuth token carries a scope set that Grafana intersects with the role. So the
  fix is at the MCP grant level, not a permission to add. See
  `docs/agent/pending-user-actions.md` §10 for the exact JSON to apply by hand
  in the meantime.
- **Known coverage gap**: the rules count 5xx that emitted an error/warn line.
  A handler that *returns* a 5xx envelope without logging — today only
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
