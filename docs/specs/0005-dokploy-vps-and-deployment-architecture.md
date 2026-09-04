# 0005. Dokploy VPS Staging/Prod Separation and Webhook CI/CD Architecture

## Goal

Define and codify the canonical production-ready technical architecture for running CoffeeMode on a Dokploy-managed Virtual Private Server (VPS). This architecture enforces isolation between Staging and Production stacks, establishes dual Cloudflare edge and R2 storage environments, and standardizes automated webhook-based CI/CD without third-party SaaS overhead or external cost cliffs.

## Status

Accepted (2026-09-04 — BRAWUKA-50 architecture and deployment specification; revised with reviewer findings).

## Stable decisions

```text
1. Self-Hosted Dokploy VPS PaaS & Deployment Modes:
   CoffeeMode deploys on a dedicated self-hosted Dokploy PaaS running on a single
   hardened Linux VPS (Debian/Ubuntu LTS) with Docker Engine and Traefik reverse proxy.
   Dokploy supports two compose deployment modes:
   - Docker Swarm Stack Mode (RECOMMENDED for zero-downtime): With Docker Swarm
     initialized on the VPS (`docker swarm init`), Dokploy deploys via `docker stack deploy`,
     which honors `deploy.update_config` with `order: start-first`.
   - Plain Docker Compose Mode: Deploys via `docker compose up -d` (brief in-place
     container recreation), where Traefik dynamically shifts traffic once the new
     container's healthcheck passes on `/api/health`.

2. Dual-Stack Environment Architecture (Backend & Data Isolation):
   Staging and Production environments run as separate Dokploy compose stacks.
   - Database, storage, and backend networks are 100% isolated:
     - Staging Database: postgres-staging (PostGIS 16) on isolated coffeemode-staging-network
     - Production Database: postgres-prod (PostGIS 16) on isolated coffeemode-prod-network
     - Independent persistent data volumes and backup volumes.
   - Web Ingress Network: The web containers connect to their respective backend
     database network plus the shared external `traefik-net` bridge for Traefik ingress.
   - Cloudflare Edge Isolation:
     - Staging: image-service-staging, poi-service-staging, coffeemode-images-staging R2 bucket,
       staging.coffeemode.app subdomain routing.
     - Production: image-service-prod, poi-service-prod, coffeemode-images-prod R2 bucket,
       coffeemode.app apex and www routing.

3. Trunk-Based CI/CD Branching Model:
   CoffeeMode operates strictly on a trunk-based git workflow (Spec 0003):
   - Staging Auto-Deploy: Every merge or push to `main` triggers Staging deployment
     following successful GitHub Actions CI verification gates.
   - Production Promotion: Promoted strictly from signed Git release tags (`v*`)
     created on `main` following verified staging validation.

4. Concrete Deployment & Migration Orchestration:
   Because Dokploy compose webhooks do not execute arbitrary host lifecycle scripts,
   deployments are orchestrated via `deploy/dokploy/deploy-release.sh` and `scripts/devops/upgrade-staging.sh` / `scripts/devops/upgrade-prod.sh` (documented in `docs/devops/LIFECYCLE.md`):
   - Step 1: Pre-migration database backup (`scripts/devops/backup.sh` / `deploy/dokploy/backup-postgres.sh`)
   - Step 2: Database schema migration execution (`npm run db:migrate`)
   - Step 3: Deployment trigger (Dokploy webhook or compose pull/up)
   - Step 4: Post-deployment automated smoke test (`scripts/devops/smoke-test.sh` / `deploy/dokploy/smoke-test.sh`)

5. Lean CI/CD & Zero External SaaS Overhead:
   In strict accordance with the Founder Manifesto (Spec 0000, Principle 5: Extreme
   Cost-Efficiency), no commercial APM or third-party monitoring platforms (e.g. Datadog,
   New Relic, or third-party Lighthouse SaaS) are permitted.
   - Exception: Lightweight HTTP log sink webhooks for application-level alerts (such
     as Better Stack HTTP ingest for 429 rate-limit alerts per Spec 0001 §DG129) are
     permitted, but core container health checks, CI gates, and deployment verification
     remain 100% self-hosted.

6. Database Safety & Migration Invariants:
   - Automated database snapshot/backup is MANDATORY prior to executing any schema
     migration in production.
   - Migrations adhere strictly to zero-downtime rules: nullable columns or default
     values on additions, concurrent index creation (CONCURRENTLY), and non-breaking DDL.
   - Destructive DDL (DROP TABLE, DROP COLUMN) is strictly forbidden without explicit
     Owner approval and two-phase data deprecation.

7. Cloudflare Dual Services & CDN Edge Invariants:
   - Dedicated credentials and bindings for Staging vs. Production Cloudflare services.
   - Cloudflare CDN edge rules MUST bypass caching on Supabase session cookies (sb-*)
     and Set-Cookie headers, and MUST vary cache keys on Accept-Language.
   - Cloudflare Managed Transforms must inject CF-IPCity and CF-IPCountry visitor
     location headers for city resolution (DG128).

8. Secret Hygiene:
   - Database credentials, Dokploy API/deploy tokens, Supabase service keys, and
     Cloudflare tokens MUST NEVER be committed to git.
   - Secrets are managed exclusively via Dokploy environment variables and Multica agent env.
```

## Architecture & service mapping blueprint

### 1. Service topology & container architecture

Dokploy manages multi-service Docker Compose stacks behind an integrated Traefik reverse proxy. Incoming traffic arrives at the VPS on ports 80 and 443, where Traefik handles TLS termination (Let's Encrypt automated ACME HTTP/DNS challenge) and routes to target application containers via Docker network labels.

```text
                                  Internet
                                     │
                    ┌────────────────┴────────────────┐
                    │     Cloudflare Edge Network     │
                    │   (WAF / DNS / Proxy / SSL)     │
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
             Host: staging.coffeemode.app    │ Host: coffeemode.app
                             │               │
            ┌────────────────▼───┐       ┌───▼────────────────┐
            │   Staging Stack    │       │  Production Stack  │
            ├────────────────────┤       ├────────────────────┤
            │ coffeemode-web-    │       │ coffeemode-web-    │
            │ staging (:3000)    │       │ prod (:3000)       │
            │         │          │       │         │          │
            │ coffeemode-staging-│       │ coffeemode-prod-   │
            │ network (isolated) │       │ network (isolated) │
            │         │          │       │         │          │
            │ postgres-staging   │       │ postgres-prod      │
            │ (:5432 internal)   │       │ (:5432 internal)   │
            │         │          │       │         │          │
            │ Named Volumes:     │       │ Named Volumes:     │
            │ - data_staging     │       │ - data_prod        │
            │ - backups_staging  │       │ - backups_prod     │
            └────────────────────┘       └────────────────────┘
```

### 2. Network & storage isolation guarantees

1. **Network topology**:
   - `coffeemode-staging-network`: Isolated bridge connecting `coffeemode-web-staging` and `postgres-staging`.
   - `coffeemode-prod-network`: Isolated bridge connecting `coffeemode-web-prod` and `postgres-prod`.
   - `traefik-net`: External bridge shared only by the web tier (`web-staging`, `web-prod`) and Traefik for HTTP ingress routing.
   - Database containers (`postgres-staging`, `postgres-prod`) do NOT connect to `traefik-net`. Containers in the Staging network cannot resolve DNS names or initiate TCP connections to the Production database.
   - Neither database exposes port 5432 to public interfaces. Administrative access is restricted to loopback (`127.0.0.1`) bastion SSH tunnels.

2. **Persistent storage mounts**:
   - Staging Data: `coffeemode_postgres_staging_data` mounted to `/var/lib/postgresql/data`.
   - Staging Backups: `coffeemode_postgres_staging_backups` mounted to `/backups` (retention: 7 days).
   - Production Data: `coffeemode_postgres_prod_data` mounted to `/var/lib/postgresql/data`.
   - Production Backups: `coffeemode_postgres_prod_backups` mounted to `/backups` (retention: 14 days local, 30 days R2).

3. **Resource allocation & limits**:
   - `coffeemode-web-prod`: CPU limit: 2.0 cores, Memory limit: 2 GB (Reservation: 1.0 core, 1 GB).
   - `postgres-prod`: CPU limit: 2.0 cores, Memory limit: 4 GB (Reservation: 1.0 core, 2 GB).
   - `coffeemode-web-staging`: CPU limit: 1.0 core, Memory limit: 1 GB.
   - `postgres-staging`: CPU limit: 1.0 core, Memory limit: 1.5 GB.

### 3. Cloudflare dual services & edge matrix

| Dimension | Staging Environment | Production Environment |
| --- | --- | --- |
| Primary Web Domain | `staging.coffeemode.app` | `coffeemode.app` (apex) |
| Secondary Web Domain | None | `www.coffeemode.app` (301 redirect to apex) |
| Cloudflare Proxy Mode | Orange-cloud (Proxied) | Orange-cloud (Proxied) |
| SSL / TLS Encryption | Full (Strict) | Full (Strict) |
| Min TLS Version | TLS 1.3 | TLS 1.3 |
| Edge Caching Rule | Bypass cache for all routes | Cache HTML shells (`s-maxage`); Bypass on `sb-*` cookies & `Set-Cookie` |
| Edge Cache Vary Header | N/A | Vary: `Accept-Language` (prevents locale cross-pollution, Spec 0001) |
| Cloudflare Managed Transforms | Add visitor location headers (`CF-IPCity`, `CF-IPCountry`) | Add visitor location headers (`CF-IPCity`, `CF-IPCountry`) |
| Image Storage (R2 Bucket) | `coffeemode-images-staging` | `coffeemode-images-prod` |
| Public Image CDN Domain | `staging-images.coffeemode.app` | `images.coffeemode.app` (`R2_PUBLIC_HOST` in `web/lib/images/constants.ts`) |
| Image Worker Service | `image-service-staging` | `image-service-prod` |
| POI Worker Service | `poi-service-staging` | `poi-service-prod` |
| Worker D1 Database | `poi-store-staging` | `poi-store` |
| Worker KV Namespace | `poi-cache-staging` | `poi-cache` |
| Supabase Auth Instance | Staging project (or preview mock) | Production project |
| Rate Limiter Backend | `memory` (single container) | `memory` (single container) / `postgres` (multi-replica) |

## CI/CD & deployment flow specification

### 1. Trunk-based deployment pipeline & trigger conditions

```text
  Developer PR ──> CI Gates (ci.yml) ──> Merge to main
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
             Staging Pipeline                                 Production Promotion
          (Automated from main)                             (Signed tag v* on main)
                     │                                                 │
                     ▼                                                 ▼
          deploy-release.sh staging                         deploy-release.sh prod
  ┌─────────────────────────────────────┐           ┌─────────────────────────────────────┐
  │ 1. backup-postgres.sh staging       │           │ 1. backup-postgres.sh prod          │
  │ 2. npm run db:migrate               │           │ 2. npm run db:migrate               │
  │ 3. Dokploy deploy webhook / compose │           │ 3. Dokploy deploy webhook / compose │
  │ 4. smoke-test.sh staging            │           │ 4. smoke-test.sh prod               │
  └─────────────────────────────────────┘           └─────────────────────────────────────┘
```

1. **Staging Continuous Deployment Flow**:
   - **Trigger**: Merge or push to `main` branch after GitHub Actions test gates pass.
   - **Execution**: Run `deploy/dokploy/deploy-release.sh staging`:
     1. Creates staging database backup (`deploy/dokploy/backup-postgres.sh staging pre-migration`).
     2. Applies schema migrations: `npm run db:migrate` against `postgres-staging`.
     3. Triggers Dokploy staging deploy webhook (or `docker compose up -d`).
     4. Executes automated smoke tests (`deploy/dokploy/smoke-test.sh staging`).

2. **Production Promotion Flow**:
   - **Trigger**: Creation of signed Git release tag `v*` on `main` following staging verification.
   - **Execution**: Run `deploy/dokploy/deploy-release.sh prod`:
     1. Creates mandatory production database backup (`deploy/dokploy/backup-postgres.sh prod pre-migration`).
     2. Applies schema migrations: `npm run db:migrate` against `postgres-prod`.
     3. Triggers Dokploy production deployment.
     4. Executes automated smoke tests (`deploy/dokploy/smoke-test.sh prod`).

### 2. Zero-downtime deployment execution

When the VPS runs in Docker Swarm mode, Dokploy stack deployments honor:

```yaml
deploy:
  update_config:
    order: start-first
    failure_action: rollback
    delay: 5s
    monitor: 15s
    max_failure_ratio: 0
```

- Traefik probes `GET /api/health` every 5 seconds.
- In Swarm mode, the new container starts and attains healthy status before the old container is drained and stopped.
- In plain Compose mode, container swap is fast in-place, and Traefik directs incoming HTTP requests to the healthy container.

### 3. Database safety & rollback runbook

1. **Pre-migration snapshot**:
   `deploy/dokploy/backup-postgres.sh` executes `pg_dump -Fc` before every migration.
   Snapshots are stored in `/backups/coffeemode_${ENV}_pre-migration_${TIMESTAMP}.dump`.
   Retention: 14 days locally for production (30 days in R2), 7 days locally for staging.

2. **Zero-downtime migration rules**:
   - Adding columns: MUST be nullable or specify a constant default (`DEFAULT '...'`).
   - Adding indexes: MUST use `CREATE INDEX CONCURRENTLY` to avoid table locking.
   - Modifying columns: Add new column, backfill data, switch application code, drop old column in a subsequent release.
   - Destructive DDL (`DROP TABLE`, `DROP COLUMN`) is prohibited without explicit Owner approval and data deprecation across two release cycles.

3. **Rollback runbook**:
   - **Application rollback**: Roll back to the previous Git commit/image tag via Dokploy dashboard or webhook.
   - **Database rollback**:
     ```bash
     deploy/dokploy/restore-postgres.sh prod /backups/coffeemode_prod_pre-migration_<TIMESTAMP>.dump
     ```

### 4. Staging verification checklist & automated smoke tests

The automated smoke test suite (`deploy/dokploy/smoke-test.sh`) verifies the following criteria:

- [ ] Healthcheck endpoint `GET /api/health` returns `{"ok":true}` with HTTP 200.
- [ ] Root page `GET /` returns HTTP 200 with HTML shell and title CoffeeMode.
- [ ] PostGIS spatial query `GET /api/cafes?lat=1.3521&lng=103.8198&radius_km=5` returns HTTP 200 with `{"cafes":[...]}`.
- [ ] Next.js standalone static asset resolution: extracts `/_next/static/` asset path from `/` and verifies HTTP 200.
- [ ] Security header: `X-Content-Type-Options: nosniff`.
- [ ] Cloudflare Worker POI service proxy: `GET /api/places/search?q=coffee` returns HTTP 200.
- [ ] Cloudflare R2 images CDN edge connectivity: probes public image CDN host and verifies edge responsiveness (HTTP 200, 403, or 404).

## Edge cases

| Scenario | Architectural Handling |
| --- | --- |
| VPS host reboot or crash | Dokploy and Docker daemon restart on system boot. Containers configure `restart: unless-stopped`. Traefik recovers Let's Encrypt certificates from persistent acme.json volume. |
| Production database migration failure | Pre-migration snapshot exists. Deploy pipeline (`deploy-release.sh`) halts prior to deployment swap. The live container continues serving traffic against the unmodified schema. |
| Cloudflare CDN caching session cookies | Traefik / Next.js emit `Cache-Control: private, no-cache` on authenticated responses. Cloudflare CDN cache rule explicitly configured to BYPASS caching whenever request cookie contains `sb-*` or response header contains `Set-Cookie`. |
| Accept-Language cache poisoning | Next.js App Router sets `s-maxage` on public pages (`/cafes/[id]`, sitemaps). Cloudflare CDN rule enforces Cache Vary on `Accept-Language` to prevent English visitors from receiving cached Chinese shells (Spec 0001, DG105/DG110). |
| Docker disk space exhaustion from images | Dokploy scheduled system prune removes dangling images and exited build containers. Host backup retention policy prunes local archives older than 14 days (prod) or 7 days (staging). |

## Acceptance criteria

```text
- docs/specs/0005-dokploy-vps-and-deployment-architecture.md is indexed in docs/specs/README.md.
- Dual-stack Staging and Production isolation rules are codified across compute, database, storage, and edge.
- Docker Compose configuration templates exist for both Staging and Production in deploy/dokploy/.
- Concrete release orchestrator script exists in deploy/dokploy/deploy-release.sh.
- Database PostGIS 16 container, backup script, and zero-downtime migration protocol are documented and implemented.
- Environment variable templates exist (.env.staging.example and .env.prod.example).
- Automated smoke test script exists in deploy/dokploy/smoke-test.sh and scripts/devops/smoke-test.sh.
- Comprehensive operational lifecycle runbook exists in docs/devops/LIFECYCLE.md.
- .agents/scripts/preflight.sh and .agents/scripts/harness-self-test.sh pass with no errors or broken links.
```
