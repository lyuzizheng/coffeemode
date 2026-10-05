# Dokploy VPS Deployment Artifacts & Automation

This directory contains Dokploy VPS deployment configurations, operational scripts, and automation hooks for CoffeeMode (Architecture: `docs/specs/0005-dokploy-vps-and-deployment-architecture.md`).

## Contents

- `docker-compose.prod.yml`: Production Compose stack for VPS deployment.
- `docker-compose.staging.yml`: Staging Compose stack for VPS deployment.
- `.env.prod.example` / `.env.staging.example`: Environment variable templates.
- `nightly-recompute.sh`: Canonical script for nightly `work_stats` recompute and Helpful ranking snapshot.
- `deploy-release.sh`: Production release deployment orchestrator with zero-downtime rolling restart.
- `backup-postgres.sh` / `restore-postgres.sh`: Database backup and disaster recovery drill scripts.
- `smoke-test.sh`: Post-deployment automated smoke tests (health, static assets, spatial queries, workers).
- `cache-rules.json`: Policy contract for the `/cafes/*` shell cache — generated from `web/config/app.yaml` `seo.shellCache` by `web/scripts/generate-cache-rules.mjs` (`npm run gen:cache-rules`); `npm run check:cache-rules` fails CI on drift.
- `cloudflare-cache-rules.json`: Deployable Cloudflare ruleset bodies (`http_request_cache_settings` + `http_response_cache_settings`) generated from the same policy — the exact payload `scripts/devops/apply-cache-rules.sh` applies to the zone (BRAWUKA-834). Never hand-edit: the hand-maintained v7 payload drifted into a catch-all bypass that disabled the allow rule (BRAWUKA-836).

## Edge Cache Rules: Contract vs Deployable Ruleset (BRAWUKA-834)

`cache-rules.json` is the **policy contract** — the declared scope, TTLs, `sharedCacheAcrossLocales` invariant and `bypass.*` signals. `cloudflare-cache-rules.json` is the **deployable payload** the zone runs. Both are generated from `web/config/app.yaml` `seo.shellCache` via `web/lib/cache-policy.ts` (`npm run gen:cache-rules`); `npm run check:cache-rules` fails CI on drift in the `application-static` job. Never hand-edit either file: the hand-maintained v7 payload drifted into a catch-all bypass that disabled the allow rule (BRAWUKA-836).

`scripts/devops/apply-cache-rules.sh` is the deployment consumer: `--dry-run` prints the payload, `--apply` PUTs each phase entrypoint with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID`. It runs the checker on the exact file and phase it is about to PUT, so a payload that fails the contract, names another phase, or makes the cache-eligible rule unreachable never reaches the zone.

The contract declares no custom cache keys — they are unavailable on this zone's plan — so its signals live under `bypass.*` and locale safety is enforced with bypass rules instead of cache-key inputs.

**Rule order is load-bearing.** Cloudflare evaluates rules in order and the **last matching** action wins, so in the request phase the cache-eligible rule is **last** and every bypass precedes it. A bypass rule can only win where the cache-eligible rule does not match, because that rule's own expression excludes the session cookie, the locale cookie, `zh` `Accept-Language` and staging. The first revision of the payload (`ed012ff0`) had the cache-eligible rule first and the catch-all bypass last, which made caching unreachable for every request; `f6cfc3b0` moved the catch-all first.

The **response phase** implements the contract's `bypass.onResponseSetCookie`: a `/cafes/*` response that carries `Set-Cookie` is pinned `no-store`, so a response the origin marks private can never enter the shared cache. The request-side session-cookie bypass covers the session-refresh path, but it is a request-side proxy for a response-side property; the response rule is what makes the clause enforceable at the edge.

`scripts/devops/check-cache-policy.mjs` is the checked relationship between the two files. It evaluates the payload the way Cloudflare does (last match wins) for representative requests in both phases — default locale, `zh` header, `locale=zh` cookie, session cookie, staging, out-of-scope, and a `Set-Cookie` response — and requires the payload to implement every signal the contract declares: each active `cache: true` rule must carry the exact negation of every declared cookie, cookie prefix, `Accept-Language` substring and hostname, extracted as top-level conjuncts by token depth rather than by substring, so a partial value (`locale=fr`), a case-folded literal (`"SB-"`) or a negated compound fails closed instead of being waved through. It also requires every cache-eligible rule to keep `edge_ttl.mode: respect_origin` with no `default` override, pins every non-cacheable status to `no-store` (304 exempt on purpose), and checks the response-phase `Set-Cookie` no-store rule; disabled rules are skipped the way the edge skips them. The representative cases and payload-shape checks live in `scripts/devops/lib/cache-policy-checks.mjs`, the contract-to-payload coverage in `scripts/devops/lib/cache-policy-coverage.mjs`, and the evaluator they share in `scripts/devops/lib/rules-language.mjs`; the retained suites are `web/tests/devops/apply-cache-rules.test.ts` (applier, zero-PUT refusals) and `web/tests/devops/cache-rules-drift.test.ts` (generated artifacts and their outcomes). The guard is bounded to this policy shape: it is not a general Cloudflare Rules-language prover, and the representative request table is a regression net, not a proof over arbitrary policies.

## Schema Migrations on Every Deploy (BRAWUKA-690)

Every web container runs the idempotent migration runner (`web/scripts/migrate.mjs`) **before** the Next.js server starts, via the image entrypoint `web/docker-entrypoint.sh`:

- **Why**: the Dokploy deploy path (`build` + `up`) had no migration step, so `schema_migrations` trailed the repo and queries touching newer columns failed with Postgres `42703` (staging `cafes.source` → `/api/cafes/[id]` 500, BRAWUKA-688 → BRAWUKA-690).
- **When**: every container start — each staging/prod deploy, `docker compose up`, swarm task replacement, and restart. Current ledger → no-op; concurrent starts are serialized by `pg_advisory_lock`, and each pending migration runs in its own transaction.
- **Environment**: uses the container's own `DATABASE_URL` — the injection both compose files already declare (`${DATABASE_URL:?...}` + `env_file`). No additional Dokploy configuration, schedule, or webhook is required.
- **Fail-closed**: a migration error exits the container non-zero, so a drifted schema is never served (`restart: unless-stopped` retries on staging; prod's `deploy.update_config.failure_action: rollback` keeps the previous task). With `DATABASE_URL` unset (local/CI runs without a database) migrations are skipped and the app keeps its documented fail-closed `db_unavailable` contract.
- **Prod first deploy (BRAWUKA-500)**: the gate lives in the image, so the first `web-prod` start migrates the prod database before the server accepts traffic — no manual step to forget.
- The manual pre-deploy path (`upgrade-staging.sh` / `upgrade-prod.sh` migration step, run from a repo checkout) still works; the entrypoint re-verifies the ledger at start, so drift cannot reappear even when a deploy skips the script.

Image requirement: `web/Dockerfile` copies `db/migrations` and `docker-entrypoint.sh` into the runtime stage — those `COPY` lines are load-bearing, do not remove them.

## Nightly Recompute & Autopilot Failure Alerting (BRAWUKA-475 / BRAWUKA-476)

The nightly recompute job is scheduled daily at **02:00 UTC** (`0 2 * * *`), executing drift-correcting `work_stats` recomputation and time-decayed Helpful ranking snapshots (`DG148`).

> **Status 2026-09-21 (BRAWUKA-598): the schedule is disabled.** It is bound to
> `coffeemode-web-prod`, which has never been deployed (BRAWUKA-500, owner-deferred),
> so Dokploy aborts each run at container lookup — `Container not found for
> application 'app-bypass-solid-state-pixel-pyvr1z'` — before the command runs.
> Re-enable it as part of BRAWUKA-500 once the prod container is up. The command
> below is byte-identical to the live schedule.

### 1. Dual-Layer Failure Notification Architecture

1. **Dokploy Scheduled Job Inline Callback (Container Safe)**:
   - Production image `node:22-alpine` does not contain `curl`. Dokploy application schedule `nightly-recompute` executes natively with `node -e fetch` for zero external dependencies and safe JSON escaping.
   - Exact configured command in Dokploy Scheduled Jobs:
     ```sh
     [ -f /app/.env ] && set -a && . /app/.env && set +a; if [ -d web ]; then cd web; fi; if ! (npm run recompute:work-stats && npm run snapshot:helpful-ranking); then if [ -n "$MULTICA_AUTOPILOT_WEBHOOK_URL" ]; then node -e 'const url=process.env.MULTICA_AUTOPILOT_WEBHOOK_URL; if(url){await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({job:"nightly-recompute",error:"Nightly recompute execution failed in container",run:"dokploy:schedule:nightly-recompute"}),signal:AbortSignal.timeout(10000)}).catch(()=>{});}'; fi; exit 1; fi
     ```
2. **Script-Level Execution Hook (`nightly-recompute.sh`)**:
   - Canonical orchestrator for host VPS crontab (`Option B`) or manual maintenance runs.
   - Catches recompute failures, database connection errors, or unexpected non-zero process exits via an internal `EXIT` trap.
   - Uses `node -e fetch` as primary alerting mechanism, with automatic fallback to `curl` or `wget` if Node is unavailable.
   - Structured error log lines to stderr and POST payload:
     ```json
     {
       "job": "nightly-recompute",
       "error": "<error summary>",
       "run": "<run pointer>"
     }
     ```
3. **Dokploy Platform Notification Fallback**:
   - Configured in Dokploy Settings → Notifications as a **Custom Webhook** notification pointing to the same autopilot webhook endpoint.
   - Captures scheduling-layer, container-level, or build errors as defense-in-depth.
### 2. Environment Variables

- `MULTICA_AUTOPILOT_WEBHOOK_URL`: Webhook URL for failure alerting. Configured in Dokploy Environment Variables (never committed to git or exposed in CI logs).
- `CONTAINER_NAME` (optional): Override target container name.
- `DATABASE_URL`: Production pooled database connection string (kept strictly in Dokploy VPS environment).

### 3. Incident Self-Healing Workflow

Upon receiving a failure webhook, the Multica Autopilot **CoffeeMode 运维告警自愈** (`4b90855b-46b2-481f-aeb5-0d739b8dc394`) automatically triggers:
- Creates an incident issue: `[AUTO-OPS] Dokploy 定时任务失败告警 <date>`.
- Assigns to DevOps Engineer with failure summary and run context.
- Diagnoses root causes (database latency, connection pooling, container status, script errors) and initiates remediation.
