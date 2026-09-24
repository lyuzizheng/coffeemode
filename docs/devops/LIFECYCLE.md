# CafeMood End-to-End DevOps & Infrastructure Lifecycle Plan

This document establishes the canonical operational lifecycle, deployment runbooks, and disaster recovery procedures for CafeMood. It governs cold-start server provisioning, automated dual-stack staging/production upgrades, zero-downtime rolling swaps, and offsite disaster recovery in accordance with Spec 0000 (Founder Manifesto, Principle 5: Extreme Cost-Efficiency) and Spec 0005 (Dokploy VPS Staging/Prod Separation and Webhook CI/CD Architecture).

---

## Table of Contents

1. [Core Principles & Invariants](#1-core-principles--invariants)
2. [Dual-Stack Architecture & Isolation Matrix](#2-dual-stack-architecture--isolation-matrix)
3. [Lifecycle Phase Breakdown](#3-lifecycle-phase-breakdown)
   - [Phase 1: Local Development & Preflight Verification](#phase-1-local-development--preflight-verification)
   - [Phase 2: Pull Request & Automated CI Gates](#phase-2-pull-request--automated-ci-gates)
   - [Phase 3: Staging Continuous Deployment](#phase-3-staging-continuous-deployment)
   - [Phase 4: Production Promotion & Zero-Downtime Deployment](#phase-4-production-promotion--zero-downtime-deployment)
   - [Phase 5: Instant Production Rollback](#phase-5-instant-production-rollback)
   - [Phase 6: Automated Backups & Disaster Recovery](#phase-6-automated-backups--disaster-recovery)
   - [Phase 7: Cold-Start VPS Provisioning](#phase-7-cold-start-vps-provisioning)
4. [Operational Script Reference](#4-operational-script-reference)
5. [Disaster Recovery & Recovery Drill Playbook](#5-disaster-recovery--recovery-drill-playbook)
6. [Troubleshooting & Emergency Runbook](#6-troubleshooting--emergency-runbook)

---

## 1. Core Principles & Invariants

1. **Zero External SaaS Overhead (Spec 0000, Principle 5)**:
   - Core infrastructure management, health checks, automated backups, and CI gates remain 100% self-hosted on VPS and Cloudflare Workers.
   - Commercial APM platforms (Datadog, New Relic) and third-party SaaS monitoring tools are strictly prohibited.
   - Self-contained in-repo scripts (`scripts/devops/smoke-test.sh`) execute all post-deployment verification.

2. **Strict Dual-Stack Isolation**:
   - Staging and Production stacks run on completely isolated Docker bridge networks and databases.
   - Database credentials, storage buckets, and secrets are strictly partitioned. Production and Staging containers never share volumes, database ports, or backend subnets.

3. **Database Pre-Migration Snapshot Invariant**:
   - Every database migration in Production MUST be preceded by an automated atomic snapshot (`scripts/devops/backup.sh --env prod --reason pre-migration`).
   - If an upgrade fails or triggers healthcheck errors, the rollback script restores the exact pre-migration snapshot in one command.

4. **Zero-Downtime Migration & Deployment Invariants**:
   - Migrations follow additive, non-breaking DDL: nullable columns, constant defaults, and concurrent index creation (`CREATE INDEX CONCURRENTLY`).
   - Destructive operations (`DROP TABLE`, `DROP COLUMN`) require explicit Owner approval and two-phase release deprecation cycles.
   - Container updates use Docker Swarm / Dokploy `order: start-first` to ensure new containers pass health checks before old containers are drained.

---

## 2. Dual-Stack Architecture & Isolation Matrix

```text
                                  Internet
                                     │
                    ┌────────────────┴────────────────┐
                    │     Cloudflare Edge Network     │
                    │  (WAF / DNS / CDN / SSL Strict) │
                    └────────────────┬────────────────┘
                                     │
                                     ▼
                     VPS Host (Dokploy / Docker Engine)
                                     │
                    ┌────────────────┴────────────────┐
                    │      Traefik Reverse Proxy      │
                    │      (:80 / :443 TLS Term)      │
                    └────────┬───────────────┬────────┘
                             │               │
                             │ (traefik-net) │
                             │               │
             Host: staging.cafemood.app    │ Host: cafemood.app
                             │               │
            ┌────────────────▼───┐       ┌───▼────────────────┐
            │   Staging Stack    │       │  Production Stack  │
            ├────────────────────┤       ├────────────────────┤
            │ coffeemode-web-    │       │ coffeemode-web-    │
            │ staging (:3000)    │       │ prod (:3000)       │
            │         │          │       │         │          │
            │ DATABASE_URL ──────┼──┐    │ DATABASE_URL ──────┼──┐
            └────────────────────┘  │    └────────────────────┘  │
                                    ▼                           ▼
                    ┌───────────────────────┐   ┌───────────────────────┐
                    │ Supabase STAGING      │   │ Supabase PROD         │
                    │ Postgres + PostGIS    │   │ Postgres + PostGIS    │
                    │ region ap-southeast-1 │   │ region ap-southeast-1 │
                    │ (pooled :6543 app /   │   │ (pooled :6543 app /   │
                    │  direct :5432 DDL)    │   │  direct :5432 DDL)    │
                    └───────────────────────┘   └───────────────────────┘
```

| Dimension | Staging Environment | Production Environment |
| --- | --- | --- |
| **Primary Ingress Domain** | `staging.cafemood.app` | `cafemood.app` (apex) |
| **Secondary Domain** | None | `www.cafemood.app` (301 redirect to apex) |
| **Backend Docker Network** | `coffeemode-staging-network` | `coffeemode-prod-network` |
| **Ingress Network** | `traefik-net` | `traefik-net` |
| **Database** | Supabase STAGING project (Postgres + PostGIS, `ap-southeast-1`) | Supabase PROD project (Postgres + PostGIS, `ap-southeast-1`) |
| **App Connection** | `DATABASE_URL` pooled (`:6543`, `sslmode=require`) | `DATABASE_URL` pooled (`:6543`, `sslmode=require`) |
| **Migration/Backup Connection** | `DIRECT_URL` session/direct (`:5432`, `sslmode=require`) | `DIRECT_URL` session/direct (`:5432`, `sslmode=require`) |
| **WAN Database Exposure**| Supabase-managed (no VPS postgres port) | Supabase-managed (no VPS postgres port) |
| **Local Backup Dir**   | `backups/staging/` | `backups/prod/` |
| **Cloudflare R2 Bucket**  | `coffeemode-images-staging` | `coffeemode-images-prod` |
| **Cloudflare R2 Backups** | `s3://coffeemode-backups/staging/` (REQUIRED — Supabase free has no auto-backups) | `s3://coffeemode-backups/prod/` (REQUIRED — Supabase free has no auto-backups) |
| **Public Image CDN Host** | `staging-images.cafemood.app` | `images.cafemood.app` |
| **Worker Services**       | `image-service-staging`, `poi-service-staging` | `image-service-prod`, `poi-service-prod` |
| **Local Backup Retention**| 7 days | 14 days (30 days in Cloudflare R2) |
---

## 3. Lifecycle Phase Breakdown

```text
Local Dev (Docker / MinIO) ──> PR CI Gates (ci.yml) ──> Merge to main
                                                              │
                     ┌────────────────────────────────────────┴────────────────────────────────────────┐
                     ▼                                                                                 ▼
         Phase 3: Staging Deploy                                                           Phase 4: Prod Promotion
        (Auto-deploy from main)                                                          (Signed tag v* on main)
                     │                                                                                 │
                     ▼                                                                                 ▼
          upgrade-staging.sh                                                                upgrade-prod.sh
  ┌───────────────────────────────┐                                                 ┌───────────────────────────────┐
  │ 1. Pre-flight migration check │                                                 │ 1. Staging verification gate  │
  │ 2. backup.sh staging          │                                                 │ 2. backup.sh prod (snapshot)  │
  │ 3. npm run db:migrate         │                                                 │ 3. Zero-downtime DDL check    │
  │ 4. Dokploy rolling update     │                                                 │ 4. npm run db:migrate         │
  │ 5. Wait for convergence       │                                                 │ 5. Dokploy rolling swap       │
  │ 6. smoke-test.sh staging      │                                                 │ 6. Wait for convergence       │
  └───────────────────────────────┘                                                 │ 7. smoke-test.sh prod         │
                                                                                    └───────────────┬───────────────┘
                                                                                                    │
                                                                                            (Anomaly Detected)
                                                                                                    ▼
                                                                                           Phase 5: Rollback
                                                                                           rollback-prod.sh
```

### Phase 1: Local Development & Preflight Verification
- **Local Stack**: Run local PostgreSQL + PostGIS 16 and MinIO S3 emulation:
  ```bash
  docker compose up -d postgres minio
  ```
- **Preflight & Invariants Check**:
  ```bash
  .agents/scripts/preflight.sh
  .agents/scripts/harness-self-test.sh
  ```
- **Local Application Verification**:
  ```bash
  npm run verify
  ```

### Phase 2: Pull Request & Automated CI Gates
Every pull request triggers GitHub Actions CI (`.github/workflows/ci.yml`) enforcing canonical gates per Spec 0003:
1. `docs-gate`: Validates documentation consistency, implementation slices, and test coverage matrix.
2. `application-static` + `application-e2e` (parallel): typecheck, ESLint, i18n key parity, structure guard, route guard (`check:guards`, apiRoute/origin allowlists), standalone build, bundle budget audit; Playwright E2E smoke + Lighthouse CI budgets. Unit tests retired (BRAWUKA-682).
3. `integration-gate`: Tests real PostGIS migrations, spatial queries, concurrent checkins, and MinIO/R2 image round-trip.

### Phase 3: Staging Continuous Deployment
- **Trigger**: Automated on every push/merge to `main` following green CI checks.
- **Executor**: `scripts/devops/upgrade-staging.sh`.
- **Workflow**:
  1. Validates pending migrations for safety.
  2. Creates staging pre-migration database backup.
  3. Executes database migrations over `DIRECT_URL` (Supabase staging session/direct connection).
  4. Triggers Dokploy staging deploy webhook (or Docker compose rolling rebuild) and waits for release convergence on `/api/health`.
  5. Runs post-deployment automated smoke tests (`scripts/devops/smoke-test.sh staging`).
  6. Runs full user-journey verification against a real PostGIS Postgres
     (setup → journey suites → cleanup), per Spec 0003 §Commands:
     ```bash
     STAGING_DATABASE_URL=postgres://<host-with-CREATEDB>/coffeemode \
       SUPABASE_URL=https://<ref>.supabase.co \
       SUPABASE_SERVICE_ROLE_KEY=<key> \
       scripts/devops/run-staging-journey.sh --suite all
     ```
     In CI the `staging-journey` workflow starts a runner-local
     `postgis/postgis:16-3.4` container and points `STAGING_DATABASE_URL` at it
     (BRAWUKA-525); the staging Supabase project is touched for auth smoke
     checks only.
     Each suite provisions isolated `{prefix}_{pid}_{uuid}` databases and
     drops them in `afterAll`; orphans from crashed runs are swept by
     `web/scripts/cleanup-stale-test-dbs.mjs --apply` (dry-run by default).
     Never run two instances concurrently against one server.

### Phase 4: Production Promotion & Zero-Downtime Deployment
- **Trigger**: Git signed release tag (`v*`) created on `main` following verified staging validation and Reviewer & Architect approval.
- **Executor**: `scripts/devops/upgrade-prod.sh`.
- **Workflow**:
  1. **Pre-Promotion Staging Gate**: Executes smoke tests against Staging. If Staging is degraded or failing, production upgrade is immediately aborted.
  2. **Mandatory Safety Snapshot**: Automatically creates a pre-migration snapshot via `scripts/devops/backup.sh --env prod --reason pre-migration`.
  3. **Zero-Downtime Migration Safety Check**: Enforces non-locking DDL (`CREATE INDEX CONCURRENTLY`, nullable fields).
  4. **Migration Execution**: Applies pending migrations over `DIRECT_URL` (Supabase prod session/direct connection — never the transaction pooler).
  5. **Zero-Downtime Rolling Swap & Convergence**: Triggers Dokploy rolling update. Waits for deployment convergence before running smoke tests. Traefik directs traffic to the new container once `/api/health` reports healthy.
  6. **Post-Deployment Verification**: Runs automated smoke tests (`scripts/devops/smoke-test.sh prod`).

### Phase 5: Instant Production Rollback
- **Trigger**: Anomaly, elevated error rates, or failed post-deploy smoke tests.
- **Executor**: `scripts/devops/rollback-prod.sh`.
- **Workflow**:
  1. Automatically parses the persistent release history log (`releases.log`) to resolve the previous release's image tag and pre-migration database snapshot path.
  2. Reverts the web application container to the previous release image (via `docker service rollback` in Swarm mode, or parameterized `IMAGE_TAG` compose update).
  3. Restores the production database to the pre-migration state using `scripts/devops/restore.sh --env prod --file <SNAPSHOT> --yes`.
  4. Runs smoke tests to confirm healthy production recovery.

### Phase 6: Automated Backups & Disaster Recovery
- **Daily Scheduled Cron**:
  ```bash
  # Production daily backup at 02:00 UTC
  0 2 * * * /path/to/coffeemode/scripts/devops/backup.sh --env prod --reason scheduled >> /var/log/coffeemode-backup.log 2>&1

  # Staging weekly backup on Sunday at 03:00 UTC
  0 3 * * 0 /path/to/coffeemode/scripts/devops/backup.sh --env staging --reason scheduled >> /var/log/coffeemode-backup.log 2>&1
  ```
- **Grandfather-Father-Son (GFS) Lifecycle**:
  - **Daily Tier**: Automated daily backups retained for 14 days (prod) or 7 days (staging).
  - **Weekly Tier**: Backups taken on Sundays retained for 28 days (4 weeks).
- **Database Backup Source**:
  - `pg_dump -Fc` runs against `DATABASE_URL` (Supabase pooled, `sslmode=require`) with gzip-9; single session, never parallel.
  - REQUIRED (not optional): Supabase free tier ships no automated backups, so `pg_dump → R2` is the only offsite copy.
- **Configuration Archiving**:
  - Atomic PostgreSQL compressed dump (`pg_dump -Fc` with gzip-9).
  - Deployment and environment configuration archiving (`.tar.gz` with SHA256 checksums).
  - No physical volume tar: there is no self-hosted postgres data volume.
- **Offsite Replication**: Backups and checksums are replicated offsite to Cloudflare R2 bucket `s3://coffeemode-backups/<env>/`.
### Phase 7: Cold-Start VPS Provisioning
- **Target**: Blank Ubuntu or Debian LTS server.
- **Orchestration**: Run `scripts/devops/bootstrap.sh` from the repository:
  1. Installs core utilities, security tools, swap, and production kernel sysctl parameters.
  2. Hardens firewall (UFW) and sets up fail2ban for SSH brute-force defense.
  3. Installs Docker CE, Docker Compose plugin, and initializes Docker Swarm.
  4. Configures Dokploy PaaS and Traefik reverse proxy on ports 80/443.
  5. Provisions Cloudflare R2 buckets (`coffeemode-images-staging`, `coffeemode-images-prod`, `coffeemode-backups`), CORS rules, and DNS records.
  6. Creates isolated bridge networks (`coffeemode-staging-network`, `coffeemode-prod-network`).
  7. Verifies Supabase prod + staging projects (PostGIS present) and runs migrations over `DIRECT_URL` (session/direct).
  8. Seeds service account profile (`00000000-0000-4000-a000-000000000001`).
  9. Builds and deploys web containers and runs end-to-end smoke tests.

---

## 4. Operational Script Reference

All operational scripts live canonically under `scripts/devops/` and are fully executable, idempotent, and self-documenting via `--help`. Legacy paths under `deploy/dokploy/` provide thin forwarding wrappers delegating to these canonical scripts:

| Script | Purpose | Key Flags |
| --- | --- | --- |
| `provision-vps.sh` | Hardens and provisions a blank Ubuntu/Debian server | `--ssh-port`, `--swap-size`, `--skip-docker`, `--dry-run` |
| `bootstrap.sh` | End-to-end cold-start orchestrator from zero to live | `--env [staging\|prod\|both]`, `--skip-vps-prep`, `--skip-cloudflare`, `--dry-run` |
| `upgrade-staging.sh` | Upgrades staging service with migrations and smoke tests | `--deploy-url`, `--skip-backup`, `--image-tag`, `--dry-run` |
| `upgrade-prod.sh` | Zero-downtime production upgrade with staging gate & safety snapshot | `--skip-staging-gate`, `--deploy-url`, `--image-tag`, `--dry-run` |
| `rollback-prod.sh` | Instant rollback of container image and database to pre-migration state | `--backup-file`, `--image-tag`, `--yes`, `--dry-run` |
| `backup.sh` | Atomic `pg_dump -Fc` compressed backup + volume + R2 GFS upload | `--env`, `--type [db\|vol\|full]`, `--reason`, `--retention-days`, `--dry-run` |
| `restore.sh` | Restores database archive with PostGIS verification & drill mode | `--env`, `--file`, `--download-r2`, `--drill`, `--yes`, `--dry-run` |
| `smoke-test.sh` | In-repo post-deployment automated health verification | `staging\|prod`, `--url <override>`, `--timeout <sec>`, `--cf-client-id <id>`, `--cf-client-secret <sec>` |
| `provision-supabase.sh` | Idempotent Supabase Postgres & Auth provisioning, PostGIS check, and RLS defense | `--database-url`, `--supabase-url`, `--verify-only`, `--dry-run` |
---

## 5. Disaster Recovery & Recovery Drill Playbook

### Disaster Recovery Scenario A: Data Corruption or Bad Migration in Production
1. Immediately stop incoming writes (if necessary) and identify the pre-migration snapshot:
   ```bash
   ./scripts/devops/rollback-prod.sh
   ```
2. If restoring to a specific known snapshot:
   ```bash
   ./scripts/devops/restore.sh --env prod --file /backups/coffeemode_prod_pre-migration_YYYYMMDD_HHMMSSZ.dump.gz --yes
   ```
3. Verify production health:
   ```bash
   ./scripts/devops/smoke-test.sh prod
   ```

### Disaster Recovery Scenario B: Total VPS Hardware Failure (Cold-Start Rebuild)
1. Provision a new VPS instance at your provider (Ubuntu 24.04 or Debian 12 LTS).
2. Clone repository:
   ```bash
   git clone https://github.com/lyuzizheng/coffeemode.git /opt/coffeemode
   cd /opt/coffeemode
   ```
3. Run cold-start bootstrap:
   ```bash
   ./scripts/devops/bootstrap.sh --env both
   ```
4. Restore production database from offsite Cloudflare R2 backup:
   ```bash
   ./scripts/devops/restore.sh --env prod --download-r2 coffeemode_prod_scheduled_YYYYMMDD_HHMMSSZ.dump.gz --yes
   ```
5. Run smoke tests:
   ```bash
   ./scripts/devops/smoke-test.sh prod
   ```

### Scheduled Recovery Drill (Quarterly Exercise)
To verify backup viability without touching production or staging data, run non-destructive recovery drills:
```bash
./scripts/devops/restore.sh --env staging --file /path/to/backup.dump.gz --drill
```
In drill mode (`--drill`), the script always targets the STAGING Supabase project:
1. Validates SHA256 checksum and archive integrity.
2. Creates a scratch database `restore_drill_<timestamp>_<pid>` on staging.
3. Restores schema, tables, and spatial data into the scratch database.
4. Executes PostGIS extension checks, row count audits, and spatial queries.
5. Drops the scratch database and reports a verified `PASSED` result.

---

## 6. Troubleshooting & Emergency Runbook
### Emergency Contacts & Role Handoff
- **DevOps Engineer**: `CafeMood DevOps Engineer` (ID: `1ef2f9d7-6869-40ec-ac8f-c36b6fc83e98`)
- **Reviewer & Architect**: `Reviewer & Architect` (ID: `39d21aed-70bd-47ec-8c74-f3215135cccf`)
- **Owner (Major Decisions & Escalations)**: `Zizheng Lyu` (ID: `4e729c90-66e8-400c-910f-ea0a6e79ee61`)
### Common Triage Commands
- **Check container health**:
  ```bash
  docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  ```
- **Inspect web application logs**:
  ```bash
  docker logs --tail 100 -f coffeemode-web-prod
  ```
- **Verify Supabase connectivity** (no local postgres container; per-env scoped vars only):
  ```bash
  psql "$PROD_DIRECT_URL" -c "SELECT PostGIS_Version();"     # prod
  psql "$STAGING_DIRECT_URL" -c "SELECT PostGIS_Version();"  # staging
  ```
- **Verify Traefik ingress status**:
  ```bash
  docker logs --tail 100 -f dokploy-traefik
  ```
- **Check disk space**:
  ```bash
  df -h
  docker system df
  ```
- **Prune dangling Docker images**:
  ```bash
  docker image prune -f
  ```

### Manual Docker Compose Execution Note
Docker Compose interpolates variable expressions like `${DATABASE_URL:?...}` from the host shell environment and project `.env`, not the service `env_file`. When running compose commands manually outside Dokploy, always pass the target environment file:
```bash
# Staging manual compose run
docker compose --env-file deploy/dokploy/.env.staging -f deploy/dokploy/docker-compose.staging.yml up -d

# Production manual compose run
docker compose --env-file deploy/dokploy/.env.prod -f deploy/dokploy/docker-compose.prod.yml up -d
```

### Dokploy Resource Limits Need a Unit Suffix
Dokploy hands `memoryLimit` / `memoryReservation` straight to the Docker API, which parses a bare number as **bytes**. `512` therefore means 512 bytes, not 512 MB, and the service is rejected before any container is created:
```text
(HTTP code 400) unexpected - rpc error: code = InvalidArgument
desc = invalid memory value 512: Must be at least 4MiB
```
Always carry the unit — `512M`, `1G`. This surfaced on 2026-09-21 as a build failure for the (since retired) `coffeemode-mcp-grafana` app (BRAWUKA-599). Neither `coffeemode-web-prod` nor `coffeemode-web-staging` sets a memory limit today, so no current service carries the misconfiguration.
