# 0010. Environments and Secrets

## Goal

Define the canonical local / staging / production environment matrix and the
ownership rules for every secret and credential, so that "local development and
integration tests run against staging" is safe, repeatable, and auditable.

This spec owns **which backends exist per environment and who may hold which
secret**. Spec 0003 owns **how the test layers and CI gates run** against them;
spec 0005 owns **how the VPS, Dokploy stacks, and Cloudflare edge are wired**.
When a decision touches more than one of these, the matrix below is the single
source of truth and the other specs reference it.

## Status

Accepted (BRAWUKA-335, owner decision 2026-09-15: development uses the staging
Supabase project with Google OAuth; local and integration testing standardize on
staging).

## Stable decisions

### 1. Environment matrix

One row per environment. No cell may be left implicit — a backend not listed
here does not exist for that environment.

| Dimension | Local (developer machine) | Staging | Production |
| --- | --- | --- | --- |
| Supabase project ref | none — `supabase-mock` (compose, `:54321`) or `supabase start` only when offline | `ojujmjewtbquiddswyrg` (ap-southeast-1) | `rsdzcegylqgccaneomph` (ap-southeast-1) |
| Auth providers | fake JWT (mock) — deterministic, unsigned | Google OAuth (enabled); email | Apple + Google OAuth |
| Postgres instance | `postgis/postgis:16-3.4` container (docker-compose) | Supabase staging Postgres + PostGIS 16 | Supabase prod Postgres + PostGIS 16 |
| Postgres connection | `localhost:5432` direct | runtime: Supavisor pooler `:6543`; migrations/DDL/scratch-DB admin: `DIRECT_URL` session `:5432` — never the transaction pooler | same split as staging |
| Object storage | MinIO container (compose) | R2 `coffeemode-images-staging` | R2 `coffeemode-images-prod` |
| Backup storage | none | R2 `coffeemode-backups/staging/` (7-day local retention) | R2 `coffeemode-backups/prod/` (14-day local, 30-day R2) |
| Workers | miniflare-poi / miniflare-image (compose, `wrangler dev --local`) | `poi-service-staging`, `image-service-staging` (D1 `poi-store-staging`, KV `poi-cache-staging`) | `poi-service-prod`, `image-service-prod` (D1 `poi-store`, KV `poi-cache`) |
| Web domain | `localhost:3000` | `staging.cafemood.app` | `cafemood.app` + `www.cafemood.app` (301) |
| Image CDN domain | MinIO local URL | `staging-images.cafemood.app` | `images.cafemood.app` |
| Who can access | the developer only | public URL; test data only, no real user data | public; real user data |

### 2. Data-store ruling (resolves the spec 0001 / `.env.example` contradiction)

**Application data lives in Supabase Postgres in every deployed environment.**
Spec 0001 §Data layer and ADR-0002 (revised 2026-08-28, 0004 decision 34a)
already record this; `deploy/dokploy/.env.staging.example` (`DATABASE_URL` →
Supavisor `:6543`, `DIRECT_URL` → `:5432`) is the correct shape. The stale side
is the wording "Supabase is AUTH ONLY / data lives in the self-hosted Postgres"
in `web/.env.example` and `web/README.md` — corrected by this change. No
self-hosted Postgres exists on the VPS (BRAWUKA-241).

Local development keeps a **local** `postgis/postgis:16-3.4` container as the
default `DATABASE_URL` for app data, while auth defaults to the **staging**
Supabase project (§3). Rationale: local writes must never pollute shared staging
business tables (§4), and a local container keeps the dev loop offline-capable
and free of staging latency. The split is deliberate: auth is remote (staging),
app data is local.

### 3. Authentication and test-session acquisition

- **Local manual development**: default auth target is the staging Supabase
  project with real Google OAuth. `supabase-mock` is retained for offline work
  and for tests that must not touch the network; it is never the staging or CI
  backend.
- **Unit / component tests**: unchanged — `web/tests/helpers/auth.ts:fakeJwt`
  (unsigned deterministic JWT) plus `mockSupabaseServerClient`. Unit tests never
  perform real auth.
- **Integration tests against local Postgres (CI `integration-gate`)**:
  unchanged — hermetic, no Supabase dependency.
- **Staging journey suites** (real sessions, non-interactive): a per-run test
  user is created through the Supabase **Admin API** (`auth.admin.createUser`)
  with the staging `service_role` key, then a real session is obtained via
  password grant (`grant_type=password`). The test user is deleted in
  `afterAll`. Interactive Google OAuth is verified manually and by staging smoke
  tests, never in automation.
- **`service_role` boundary**: the key is server-side only — GitHub Actions
  `staging` environment secrets and Dokploy server env. It MUST NOT appear in
  any `NEXT_PUBLIC_*` variable, any committed file, or any client bundle.
- **Fake-JWT single source (G4)**: `scripts/supabase-mock.mjs` and
  `web/tests/helpers/auth.ts` MUST NOT maintain two hand-synced JWT builders.
  One shared implementation is the source of truth (extraction tracked under
  Stage 3, BRAWUKA-336); until it lands, the existing header-comment sync rule
  is a P1 review item, not a convention to extend.

### 4. Shared-staging data isolation

- **Scratch databases per suite**: every staging-bound suite provisions its own
  database `{prefix}{pid}_{uuid}` via `provisionTestDatabase`
  (`web/tests/helpers/db.ts`), cloned from a migrated template database, and
  drops it in `afterAll`. This mechanism already exists and is the canonical
  one — it gives strong isolation and is parallel-safe.
- **Hard rule**: no test may write the shared staging business schema
  (`profiles`, `cafes`, `checkins`, …). Guards: `assertSafeSeedClient` /
  `assertSafeSeedTarget` fail closed, and any non-local `DATABASE_URL` requires
  `ALLOW_REMOTE_INTEGRATION_DB=1`.
- **Orphan sweep**: `web/scripts/cleanup-stale-test-dbs.mjs --apply` drops
  leftover scratch DBs (name pattern + zero backends). The staging journey
  runner executes it after every run.
- **Serialization**: staging runs are serialized — one journey run at a time,
  enforced by the workflow `concurrency` group (§5) and the runner's own guard.
  Within a run, Vitest workers each get their own scratch DB.
- **Required privilege**: the role behind `STAGING_DATABASE_URL` needs
  `CREATEDB` on the staging cluster and MUST connect over the session/direct
  endpoint (`:5432`) — `CREATE DATABASE` cannot run through the transaction
  pooler.
- **Rejected alternatives**: shared-schema + truncate (races, pollutes business
  data); transaction rollback (cannot span HTTP requests); a separate Supabase
  project per run (cost, config drift, provision latency).

### 5. CI/CD gate ownership and secret boundaries

- **PR gates stay hermetic**: `ci.yml` never depends on staging, live provider
  keys, or external network services (spec 0003 test policy). A staging outage
  must never block a merge.
- **`staging-journey` gate**: a dedicated workflow
  (`.github/workflows/staging-journey.yml`) running `run-staging-journey.sh` on
  `push` to `main`, on a nightly `schedule`, and on `workflow_dispatch`.
  `concurrency: staging-journey` with `cancel-in-progress: false` serializes
  runs. Secrets come from the GitHub Environment `staging`. Failure opens a
  tracking issue / notifies; it never blocks PR merge. (Closes G5: the script
  previously had no CI entry.)
- **Production promotion**: signed tag `v*` on `main` **plus** manual owner
  approval (GitHub Environment `production` required reviewer) **plus** a green
  `staging-journey` run on the promoted commit. Spec 0005 §CI/CD owns the
  release mechanics; this spec owns the approval boundary.
- **Secret ownership matrix**:

| Secret | Lives in | Never in |
| --- | --- | --- |
| prod `service_role`, prod `DATABASE_URL`/`DIRECT_URL` | Dokploy prod env, GH Environment `production` | local `.env`, client bundle, `NEXT_PUBLIC_*` |
| staging `service_role`, `STAGING_DATABASE_URL` | GH Environment `staging`, Dokploy staging env | client bundle, `NEXT_PUBLIC_*`; local `.env` discouraged (dev uses anon key + own Google login) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.example` templates, Dokploy env | — (public by design; RLS + revoked default grants protect tables) |
| R2 access keys, Cloudflare tunnel/API tokens | Dokploy env, GH Environment per env | local `.env` unless actively debugging that integration |
| `BETTER_STACK_INGEST_URL` | Dokploy env per env | — (ingest-only token) |

- **Client bundle rule**: only `NEXT_PUBLIC_*` values may reach the browser.
  Anything that can write (service_role, R2 keys, DB URLs) is server-side.

### 6. Threshold ownership

This spec introduces no new tunable numbers. Should one become necessary (e.g.
a scratch-DB retention TTL), it lands in `web/config/app.yaml` and is mirrored
in spec 0009 §3 per that spec's two-location rule — never inline in a script.

## Edge cases

| Scenario | Handling |
| --- | --- |
| Staging Supabase unreachable during a PR | Nothing happens — PR gates are hermetic by design; only the post-merge/nightly `staging-journey` reports failure. |
| Crashed staging run leaves scratch DBs | Next run's `cleanup-stale-test-dbs.mjs --apply` sweep drops them (name pattern + zero backends). |
| Concurrent staging runs | Workflow `concurrency` group serializes; a second runner instance exits on the script-level guard. |
| `service_role` leaks into a client bundle | `secret-scan` (gitleaks) + the `NEXT_PUBLIC_*`-only rule above; a leaked key is rotated immediately. |
| Developer offline | `supabase-mock` + local Postgres keep the full dev loop working; staging auth is the default, not a hard requirement. |
| Test user left behind on staging | `afterAll` deletes it; a failed run leaves a `test+*` auth user that the next run's setup may clean — acceptable residue, no business data. |

## Tests / acceptance criteria

- This spec is indexed in `docs/specs/README.md` and cross-referenced from
  specs 0001 (data layer), 0003 (test layers / CI design), and 0005 (edge
  matrix / promotion flow).
- The matrix in §1 names a concrete backend for every environment × dimension
  cell; "TBD" is not a valid cell.
- `web/.env.example` and `web/README.md` no longer claim a self-hosted Postgres
  for app data.
- Spec 0003 records: the staging-journey layer, the registered↔measured
  set-equality rule, and the hermetic-PR / staging-verification gate split.
- Spec 0005 records the manual-approval + staging-green promotion boundary.
- `.agents/scripts/preflight.sh` and `.agents/scripts/harness-self-test.sh`
  pass; independent semantic review per `.agents/docs-semantic-review.md`.
