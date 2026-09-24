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
- `cache-rules.json`: Cloudflare edge cache rule definitions.

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
