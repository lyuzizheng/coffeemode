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

## Nightly Recompute & Autopilot Failure Alerting (BRAWUKA-475 / BRAWUKA-476)

The nightly recompute job runs daily at **02:00 UTC** (`0 2 * * *`), executing drift-correcting `work_stats` recomputation and time-decayed Helpful ranking snapshots (`DG148`).

### 1. Dual-Layer Failure Notification Architecture

1. **Script-Level Execution Hook (`nightly-recompute.sh`)**:
   - Catches recompute failures, database connection errors, or unexpected non-zero process exits via an internal `EXIT` trap.
   - Formats structured JSON error lines to stderr for log sinks.
   - When `MULTICA_AUTOPILOT_WEBHOOK_URL` is set, issues a POST request with payload:
     ```json
     {
       "job": "nightly-recompute",
       "error": "<error summary>",
       "run": "<run pointer>"
     }
     ```
2. **Dokploy Platform Notification Fallback**:
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
