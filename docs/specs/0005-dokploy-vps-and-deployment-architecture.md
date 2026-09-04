# 0005. Dokploy VPS Staging/Prod Separation and Webhook CI/CD Architecture

## Goal

Define and codify the canonical production-ready technical architecture for running CoffeeMode on a Dokploy-managed Virtual Private Server (VPS). This architecture enforces 100% isolation between Staging and Production stacks, establishes dual Cloudflare edge and R2 storage environments, and standardizes automated webhook-based CI/CD without third-party SaaS overhead or external cost cliffs.

## Status

Accepted (2026-09-04 — BRAWUKA-50 architecture and deployment specification).

## Stable decisions

```text
1. Self-Hosted Dokploy VPS PaaS:
   CoffeeMode deploys on a dedicated self-hosted Dokploy PaaS running on a single
   hardened Linux VPS (Debian/Ubuntu LTS) with Docker Engine and Traefik reverse proxy.

2. Dual-Stack Environment Architecture (100% Isolation):
   Staging and Production environments are fully segregated into independent Dokploy
   stacks. They share zero database state, zero network namespaces, zero storage volumes,
   and zero runtime secrets.
   - Staging Stack:
     - Dokploy Application: coffeemode-web-staging (Next.js standalone container)
     - Dokploy Database: postgres-staging (PostgreSQL 16 + PostGIS 3.4 container)
     - Cloudflare Edge: Staging Workers (image-service-staging, poi-service-staging),
       coffeemode-images-staging R2 bucket, staging.coffeemode.app subdomain routing
   - Production Stack:
     - Dokploy Application: coffeemode-web-prod (Next.js standalone container)
     - Dokploy Database: postgres-prod (PostgreSQL 16 + PostGIS 3.4 container)
     - Cloudflare Edge: Production Workers (image-service-prod, poi-service-prod),
       coffeemode-images-prod R2 bucket, coffeemode.app apex and www routing

3. Lean CI/CD & Zero External SaaS Overhead:
   In strict accordance with the Founder Manifesto (Spec 0000, Principle 5: Extreme
   Cost-Efficiency), no third-party monitoring, APM, or audit SaaS (e.g. Datadog,
   New Relic, or third-party Lighthouse SaaS) is permitted.
   - Build and verification gates run in-repo via GitHub Actions per Spec 0003.
   - Deployments are orchestrated directly via Dokploy native webhooks and GitHub triggers.
   - Runtime health and container liveness/readiness are monitored via Traefik and Docker.

4. Database Migration & Safety Invariants:
   - Automated database snapshot/backup is MANDATORY prior to executing any schema
     migration in production.
   - Migrations adhere strictly to zero-downtime rules: nullable columns or default
     values on additions, concurrent index creation (CONCURRENTLY), and non-breaking DDL.
   - Destructive DDL (DROP TABLE, DROP COLUMN) is strictly forbidden without explicit
     Owner approval and two-phase data deprecation.

5. Cloudflare Dual Services & CDN Edge Invariants:
   - Dedicated credentials and bindings for Staging vs. Production Cloudflare services.
   - Cloudflare CDN edge rules MUST bypass caching on Supabase session cookies (sb-*)
     and Set-Cookie headers, and MUST vary cache keys on Accept-Language.
   - Cloudflare Managed Transforms must inject CF-IPCity and CF-IPCountry visitor
     location headers for city resolution (DG128).

6. Secret Hygiene:
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
             Host: staging.coffeemode.app    │ Host: coffeemode.app
                             │               │
            ┌────────────────▼───┐       ┌───▼────────────────┐
            │   Staging Stack    │       │  Production Stack  │
            │  (Dokploy Project) │       │ (Dokploy Project)  │
            ├────────────────────┤       ├────────────────────┤
            │ coffeemode-web-    │       │ coffeemode-web-    │
            │ staging (:3000)    │       │ prod (:3000)       │
            │         │          │       │         │          │
            │ coffeemode-staging-│       │ coffeemode-prod-   │
            │ net (bridge)       │       │ net (bridge)       │
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

1. **Network isolation**:
   - `coffeemode-staging-network`: Connects `coffeemode-web-staging` and `postgres-staging`.
   - `coffeemode-prod-network`: Connects `coffeemode-web-prod` and `postgres-prod`.
   - The Staging and Production networks are strictly non-overlapping Docker bridges. Containers in the Staging network cannot resolve DNS names or initiate TCP connections to containers in the Production network.
   - Neither database exposes port 5432 to the external public network interface. Access is restricted to internal Docker bridge communication and local loopback (`127.0.0.1`) administrative bastion tunnels.

2. **Persistent storage mounts**:
   - Staging Data: `coffeemode_postgres_staging_data` mounted to `/var/lib/postgresql/data`.
   - Staging Backups: `coffeemode_postgres_staging_backups` mounted to `/backups`.
   - Production Data: `coffeemode_postgres_prod_data` mounted to `/var/lib/postgresql/data`.
   - Production Backups: `coffeemode_postgres_prod_backups` mounted to `/backups`.
   - Volume paths are isolated at the host filesystem level under `/var/lib/docker/volumes/`.

3. **Resource allocation & limits**:
   - `coffeemode-web-prod`: CPU limit: 2.0 cores, Memory limit: 2 GB (Reservation: 1.0 core, 1 GB).
   - `postgres-prod`: CPU limit: 2.0 cores, Memory limit: 4 GB (Reservation: 1.0 core, 2 GB).
   - `coffeemode-web-staging`: CPU limit: 1.0 core, Memory limit: 1 GB.
   - `postgres-staging`: CPU limit: 1.0 core, Memory limit: 1.5 GB.
   Resource reservations guarantee that Staging load or automated testing never starves Production compute or memory.

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

### 1. Dokploy webhook contracts & GitHub triggers

Deployments are triggered using Dokploy native webhook API endpoints authenticated via bearer tokens:

```text
POST https://dokploy.vps.coffeemode.app/api/deploy/{DEPLOY_TOKEN}
Headers:
  Content-Type: application/json
  Authorization: Bearer {DOKPLOY_API_KEY}
Payload:
{
  "applicationId": "{APP_UUID}",
  "branch": "staging" | "main",
  "commit": "{GIT_COMMIT_SHA}"
}
```

1. **Staging Continuous Deployment Trigger**:
   - **Trigger condition**: Push or merge event to the `staging` branch (or release integration branch) after all GitHub Actions test gates pass.
   - **Pipeline**:
     1. GitHub Actions executes `ci.yml` (`application-gate`, `integration-gate`).
     2. On green build, GitHub Actions triggers the Dokploy Staging Webhook.
     3. Dokploy pulls the target commit and builds the Docker image (`web/Dockerfile`).
     4. Dokploy runs database migrations: `npm run db:migrate` against `postgres-staging`.
     5. Container restarts and Traefik verifies healthcheck (`/api/health`).
     6. Automated staging smoke test executes (`deploy/dokploy/smoke-test.sh staging`).

2. **Production Promotion Gate & Trigger**:
   - **Trigger condition**: Strictly from `main` branch or signed Git release tags (`v*`) following successful Staging verification.
   - **Promotion Protocol**:
     1. Staging verification checklist completed and confirmed.
     2. GitHub Actions runs verification on `main`.
     3. Trigger Dokploy Production deployment webhook (or manual dispatch in Dokploy dashboard).
     4. Dokploy executes pre-deployment safety backup (`deploy/dokploy/backup-postgres.sh prod`).
     5. Dokploy runs database migrations: `npm run db:migrate` against `postgres-prod`.
     6. Dokploy executes zero-downtime rolling update (`order: start-first`).
     7. Traefik verifies healthcheck on new container (`/api/health`).
     8. Traefik shifts traffic; old container is gracefully terminated.
     9. Automated production smoke test executes (`deploy/dokploy/smoke-test.sh prod`).

### 2. Zero-downtime rolling deployment configuration

Next.js standalone containers run with Traefik health checks to guarantee zero downtime:

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
- Traefik only shifts ingress traffic to the newly spun container once it responds with HTTP 200.
- If the new container fails its health check within 30 seconds, Traefik continues routing 100% of traffic to the active healthy container, Dokploy aborts the deployment, and no downtime occurs.

### 3. Database safety & migration protocol

All database schema migrations (`web/db/migrations/*.sql`) follow strict safety rules:

1. **Pre-migration snapshot**:
   `deploy/dokploy/backup-postgres.sh` executes `pg_dump -Fc` before every migration.
   The compressed snapshot is stored in `/backups/` and mirrored to R2 backup storage.

2. **Zero-downtime migration constraints**:
   - Adding columns: MUST be nullable or specify a constant default (`DEFAULT '...'`).
   - Adding indexes: MUST use `CREATE INDEX CONCURRENTLY` to avoid table locking.
   - Modifying columns: Add new column, backfill data, switch application code, drop old column in a subsequent release.
   - Destructive DDL (`DROP TABLE`, `DROP COLUMN`) is prohibited without explicit Owner approval and data deprecation across two release cycles.

3. **Automated Rollback Procedure**:
   - **Application rollback**: If application smoke tests fail post-deploy, trigger Dokploy rollback to the previous image tag via Dokploy dashboard or API webhook.
   - **Database rollback**: If migration failure corrupts state or breaks compatibility:
     ```bash
     deploy/dokploy/restore-postgres.sh prod /backups/coffeemode_prod_pre_migrate_<TIMESTAMP>.sql.gz
     ```

### 4. Staging verification checklist & automated smoke tests

Before promoting any release from Staging to Production, the automated smoke test script (`deploy/dokploy/smoke-test.sh staging`) and manual verification checklist must pass:

- [ ] Healthcheck endpoint `GET /api/health` returns `{"ok": true}` with HTTP 200.
- [ ] Root page `GET /` returns HTTP 200 with HTML shell and valid `<title>CoffeeMode</title>`.
- [ ] SSR Cafe detail page `GET /cafes/[id]` returns HTTP 200 with JSON-LD metadata and ScorePair shell.
- [ ] Static chunk verification: JS/CSS chunks under `/_next/static/` return HTTP 200 (proves standalone asset copy).
- [ ] PostGIS spatial query verification: `GET /api/cafes?lat=1.3521&lng=103.8198&radius=5` returns HTTP 200 with JSON array.
- [ ] Cloudflare R2 public image CDN connectivity: `HEAD` request to public image URL returns HTTP 200.
- [ ] Cloudflare Worker POI service proxy: `GET /api/places/search?query=coffee` returns valid POI results.
- [ ] Security headers verification: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`.

## Edge cases

| Scenario | Architectural Handling |
| --- | --- |
| VPS host reboot or crash | Dokploy and Docker daemon restart on system boot. Containers configure `restart: unless-stopped`. Traefik recovers Let's Encrypt certificates from persistent acme.json volume. |
| Staging and production port collisions | Containers communicate via internal port 3000 on separate Docker networks. Traefik discriminates based on Host header (`staging.coffeemode.app` vs `coffeemode.app`). Neither container binds host port 3000 directly. |
| Production database migration failure | Pre-migration snapshot exists. Dokploy pre-deploy script aborts deployment prior to container swap. The live production container continues serving traffic against the unmodified schema. |
| Cloudflare CDN caching session cookies | Traefik / Next.js emit `Cache-Control: private, no-cache` on authenticated responses. Cloudflare CDN cache rule explicitly configured to BYPASS caching whenever request cookie contains `sb-*` or response header contains `Set-Cookie`. |
| Accept-Language cache poisoning | Next.js App Router sets `s-maxage` on public pages (`/cafes/[id]`, sitemaps). Cloudflare CDN rule enforces Cache Vary on `Accept-Language` to prevent English visitors from receiving cached Chinese shells (Spec 0001, DG105/DG110). |
| Docker disk space exhaustion from images | Dokploy scheduled system prune removes dangling images and exited build containers. Host cron retains the last 7 daily local database snapshots and prunes older archives. |

## Acceptance criteria

```text
- docs/specs/0005-dokploy-vps-and-deployment-architecture.md is indexed in docs/specs/README.md.
- Dual-stack Staging and Production isolation rules are codified across compute, database, storage, and edge.
- Docker Compose configuration templates exist for both Staging and Production in deploy/dokploy/.
- Database PostGIS 16 container, backup script, and zero-downtime migration protocol are documented and implemented.
- Dokploy application template schema exists in deploy/dokploy/dokploy-application-template.json.
- Environment variable templates exist (.env.staging.example and .env.prod.example).
- Automated smoke test script exists in deploy/dokploy/smoke-test.sh.
- .agents/scripts/preflight.sh and .agents/scripts/harness-self-test.sh pass with no errors or broken links.
```
