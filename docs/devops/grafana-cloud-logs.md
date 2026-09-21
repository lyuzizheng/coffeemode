# Grafana Cloud Logs — Alloy on the Dokploy VPS

The `web` containers already write one JSON object per line to stdout
(`web/shared/log.ts`, `web/proxy.ts`, ADR-0004). Nothing was collecting it, so
the record died with the container. This runbook covers the collector that
ships it to Grafana Cloud Loki — **zero application changes** (BRAWUKA-607,
adoption plan §3 P0-1).

| | |
|---|---|
| Collector | `grafana/alloy:v1.19.2`, one container per Dokploy stack |
| Containers | `coffeemode-alloy-prod`, `coffeemode-alloy-staging` |
| Pipeline | `deploy/dokploy/alloy/config.alloy` (both stacks run the same file) |
| Destination | `https://logs-prod-020.grafana.net/loki/api/v1/push`, instance ID `1795570` |
| Retention | 14 days (Cloud Free) |
| Alloy UI | `http://127.0.0.1:12345` (prod) · `http://127.0.0.1:12346` (staging) — VPS loopback only |

## 1. What runs where

Each stack gets its own Alloy container, on its own stack network, with its own
credentials — staging and prod share nothing (spec 0005 §2). Both mount the
same Docker socket, so **both see every container on the host**; the
`discovery.docker` name filter (`ALLOY_WEB_CONTAINER`) is what keeps staging out
of prod's stream and vice versa.

```text
coffeemode-web-prod  ──stdout──┐
                               ├─ discovery.docker (name filter) ─┐
coffeemode-web-staging ─stdout─┘                                  │
                                                                  ▼
  discovery.relabel ──► loki.source.docker ──► loki.process ──► loki.write
   container label        env/service labels     level + metadata   Grafana Cloud
```

Neither Alloy container is on `traefik-net` and neither publishes anything
publicly. The UI/metrics port is bound to host loopback only, because a rejected
push is otherwise invisible: Alloy keeps `loki.write` "healthy" and retries
silently (see §5).

## 2. Label discipline

Cloud Free allows 5,000 active streams, so the label set is deliberately tiny:

| Kind | Fields | Why |
|---|---|---|
| Labels | `env`, `service`, `container`, `level` | Bounded. `level` is derived from the app's `type` (`error` / `warn` / `access`). |
| Structured metadata | `request_id`, `route`, `client_id` | Per-request values. As labels these would mint one stream per request. |

`client_id` is forward-looking: the rate-limit line carries it only once
`emitRateLimitAlert` emits structured JSON (adoption plan §6 decision 4). Until
then the field is simply absent — the stage does not invent it.

Loki adds two labels of its own on top: `service_name` (copied from `service`
by `discover_service_name`) and `detected_level`. Both are bounded; neither is
configured here.

Verified against a local Loki 3.6.0 with a container emitting the app's exact
line shapes:

```text
index labels        container, env, level, service, service_name
level values        access, error, warn
streams (1 container)  4
{request_id="…"}    → empty   (not an index label)
| request_id="…"    → 1 line  (structured metadata)
```

## 3. Deploy

The compose services fail fast if the credentials are missing, so set all three
in the Dokploy environment for **each** stack before deploying
(`deploy/dokploy/.env.prod.example`, `.env.staging.example`):

| Variable | Value |
|---|---|
| `GRAFANA_LOKI_URL` | `https://logs-prod-020.grafana.net/loki/api/v1/push` |
| `GRAFANA_LOKI_USER` | `1795570` (Loki instance ID) |
| `GRAFANA_LOKI_TOKEN` | Grafana Cloud API token with `logs:write` — **secret** |

Mint the token in Grafana Cloud → Administration → Cloud access policies →
Access policies → `logs:write`. Use a separate token per stack so one can be
revoked without darkening the other.

`ALLOY_ENV` and `ALLOY_WEB_CONTAINER` are set by the compose file itself and
must not be overridden.

Manual run outside Dokploy:

```bash
cd deploy/dokploy
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d alloy-prod
```

## 4. Verify

```bash
scripts/devops/verify-loki-logs.sh --env prod
```

The script queries Loki for `{env="prod", service="web"}`, asserts that
`server-log.ts` error/warn lines are present, and asserts that `request_id` is
structured metadata rather than a label. Run it for `staging` too.

By hand, in Grafana → Explore → `grafanacloud-logs`:

```logql
{env="prod", service="web"}                          # everything
{env="prod", service="web", level="error"}           # app errors
{env="prod", service="web"} | request_id="<id>"      # join with the access line
{env="prod", service="web"} | route="GET /api/cafes" # structured metadata filter
```

At the collector, on the VPS:

```bash
curl -s http://127.0.0.1:12345/-/healthy
curl -s http://127.0.0.1:12345/api/v0/web/components \
  | jq -r '.[] | select(.health.state != "healthy") | "\(.localID)\t\(.health.message)"'
curl -s http://127.0.0.1:12345/metrics | grep -E \
  '^loki_(source_docker_target_entries|write_sent_entries|write_dropped_entries|write_batch_retries|process_dropped_lines)_total'
```

`loki_source_docker_target_entries_total` counts lines read off the container;
`loki_write_sent_entries_total` counts lines accepted by Loki. A gap between
them is the first sign of a rejected push.

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Nothing in Loki, `loki_source_docker_target_entries_total` is 0 | Name filter matched no container | `docker ps --format '{{.Names}}'` on the VPS; the name must equal `ALLOY_WEB_CONTAINER` exactly |
| Nothing in Loki, `loki_write_batch_retries_total` climbing | Push rejected — bad token, wrong URL, or quota | Check the token has `logs:write` and belongs to instance `1795570`; Alloy does **not** log this, only the metric moves |
| `loki_write_dropped_entries_total{reason="rate_limited"}` climbing | Loki per-tenant ingest rate limit | Expected only under a burst; if sustained, the free-tier quota is exhausted |
| Lines missing right after a redeploy | `loki.source.docker` keys read offsets by container ID; a new container starts a new offset | Expected. The first read of a *new* container starts at its beginning, so nothing before the collector existed is lost |
| Staging logs showing up under `env="prod"` | `ALLOY_WEB_CONTAINER` overridden in Dokploy env | Remove the override — the compose file owns it |
| `loki_process_dropped_lines_total{reason="debug_level"}` climbing | A `type: "debug"` line was emitted | Working as designed; no current emitter produces one |

## 6. Quota watch (first week)

Free tier: 50 GB logs / 14 days, 5,000 active streams. The collector ships only
the `web` container and drops `debug`, so the expected volume is small — but
watch it for the first week before widening the filter.

- **Streams**: `{env="prod", service="web"}` should stay in the single digits.
  A jump means a per-request value leaked into the label set — check
  `stage.labels` in `deploy/dokploy/alloy/config.alloy`.
- **Volume**: Grafana Cloud → Billing / Usage, or the `grafanacloud-usage`
  datasource. Compare against the 50 GB ceiling.
- **Alerts**: none are wired to Loki yet; that is P1-2 in the adoption plan.

## 7. Relationship to Better Stack

Unchanged and deliberate (adoption plan §6 decision 1): stdout is the complete
record, and Alloy reading it does not affect the Better Stack sinks.
`api-error-sink.ts` and the rate-limit POST stay enabled. When Grafana Alerting
is verified, the sinks and their `BETTER_STACK_*_INGEST_*` variables are
deleted — the Alloy config is not touched.
