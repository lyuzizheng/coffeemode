# 0010. Application data on Dokploy Postgres, Supabase Auth retained

## Status

Accepted

2026-11-18, BRAWUKA-1010 / BRAWUKA-1015. Supersedes the 2026-08-28 revision in
ADR-0002 item 1 and the database half of spec 0004 decision 34a. Spec 0005 and
spec 0010 are updated to this topology.

## Context

1. **The application never used Supabase for data.** `web/lib/db/` talks to
   Postgres through `pg` and `DATABASE_URL`; no `supabase-js` call reads or
   writes application tables. Supabase serves Auth (Google/Apple OAuth, JWTs,
   sessions) and nothing else.
2. **Staging already runs this way.** BRAWUKA-507 (2026-09-20) moved staging
   application data to a Dokploy VPS Postgres service
   (`postgis/postgis:16-3.4`), leaving the Supabase staging project with Auth.
   Schema there is through migration 0033 (BRAWUKA-1013). Concrete hosts,
   ports, and credentials live in the project's private infrastructure record
   (BRAWUKA-1016), never in this repository.
3. **CI already runs this way.** `ci.yml` and `staging-journey.yml` use
   runner-local `postgis/postgis:16-3.4` containers; `SUPABASE_*` is used only
   for Auth smoke checks.
4. **Production was the only gap.** `coffeemode-web-prod` has never been
   deployed (BRAWUKA-500). `.env.prod.example` still pointed `DATABASE_URL` at
   the Supavisor pooler and `DIRECT_URL` at `db.<ref>.supabase.co`.
5. **Supabase is not neutral here.** The free tier caps storage, the pooler
   adds a hop and a connection mode, and the Data API exposes every `public`
   table unless RLS grants are maintained by hand. No migration defines an RLS
   policy; `profiles.id` is only a documented convention equal to
   `auth.users.id`, with no foreign key, so separating the two stores creates
   no constraint.
6. **The recovery path did not work as documented.** BRAWUKA-1013 found no
   verifiable backup artifact, no configured job, and 17 failed restore-drill
   CI runs. The scripts assumed a host `pg_dump`/`pg_restore`; the VPS host has
   no PostgreSQL client and the database DNS name resolves only inside
   `dokploy-network` (BRAWUKA-1013 evidence).

## Decision

### 1. Topology

- Application data for both environments lives in Dokploy-managed Postgres
  services on the VPS: the staging service (existing) and `db-prod` (planned,
  deployed by BRAWUKA-1011).
- Both use `postgis/postgis:16-3.4`, so the server major matches the CI
  container and the migration set.
- Each environment has its own container, volume, database, and role. No
  database is shared between stacks, and no staging database is reused for
  production.
- Supabase keeps Auth only. Auth variables and providers are unchanged.
- GitHub Actions keeps runner-local Postgres and per-suite scratch databases.

### 2. Connection shape

- `DATABASE_URL` and `DIRECT_URL` both point at the environment's internal
  service on port 5432 and state `sslmode=disable` explicitly:
  `postgres://coffeemode:<password>@<prod-db-host>:5432/coffeemode?sslmode=disable`,
  where `<prod-db-host>` is supplied by the environment (BRAWUKA-1016).
- `DIRECT_URL` is retained as the explicit migration/backup handle even though
  it currently resolves to the same service. It keeps the scripts' contract
  stable if a pooler is introduced later.
- No database port is published. Reachability is `dokploy-network` only, so
  the TLS mode is `disable` by design, not by omission.

### 3. Privileges

- `postgres` is the initdb superuser and is used only by database
  initialization.
- The application connects as `coffeemode` — `LOGIN`, **not** `SUPERUSER`,
  **not** `CREATEDB` — and owns the `public` schema. It creates tables and
  indexes through migrations and nothing else.
- The **authorized recovery role** is the initdb superuser (`postgres`), used
  only by `restore.sh`, `rollback-prod.sh` and drills. `pg_restore --clean`
  drops and recreates the `postgis` extension, and only a superuser can do
  that; a restore attempted with the application URL fails on
  `permission denied to create extension "postgis"`. Its connection string is
  supplied as `STAGING_RESTORE_URL` / `PROD_RESTORE_URL` in the operator shell
  and never as `DATABASE_URL`/`DIRECT_URL`. It is deliberately **not** read from
  `deploy/dokploy/.env.<env>`: that file is a compose `env_file` mounted into
  the web container, so a recovery URL stored there would be readable by the
  application process.
- Restores run with `--no-owner` and then hand every application object in
  `public` back to `coffeemode` (`RESTORE_OWNER_ROLE`, ADR step 5b), so the
  application keeps ownership of its schema across a disaster recovery while
  extension members stay with the recovery role. Verification also asserts the
  layer owners: the `public` schema belongs to the application role, and the
  database keeps the target's original owner across a `--recreate` swap.
- `postgis` is created once during initialization by the superuser. The
  migration's `create extension if not exists postgis` is a no-op afterwards.
- The health probe is a TCP connect (`pg_isready -h 127.0.0.1 -p 5432`), not a
  socket probe: during `initdb` the entrypoint runs a temporary server that
  answers socket checks, so a socket-based health check reported healthy before
  the real server existed and the first backup hit `connection refused`.

### 4. Backups and restores

- `scripts/devops/backup.sh` dumps with `pg_dump -Fc` through the
  per-environment `DIRECT_URL`, streams through gzip, writes SHA256, and
  replicates to the approved R2 bucket (`s3://coffeemode-backups/<env>/`).
- `scripts/devops/restore.sh` restores and verifies as the authorized recovery
  role, with a non-destructive `--drill` mode that creates a scratch database on
  staging, normalizes object ownership to the application role, verifies PostGIS
  and then judges the result against the archive's own table of contents: every
  archived relation must exist, no application relation may exist outside it,
  and every archived table must be readable. Row counts and the spatial query
  run for every archived table, so a migrated+seeded archive must also carry
  data. A drill passes only when the three required application relations are
  real tables (a same-name view is rejected), all three are row-audited, and
  the spatial query matches at least one cafe. A pre-migration snapshot of an
  empty database has no application relations; it verifies as an empty-schema
  baseline and is not, by itself, evidence that the seeded application
  restores. The scratch database is dropped on every exit path with
  `WITH (FORCE)`, and a drop that still fails is reported and exits nonzero.
- `--recreate` (rollback) does not drop the live database. It creates a
  replacement database with the target's original owner, restores into it,
  performs the full verification there, and only then promotes it: both
  database renames commit in one transaction, so an interrupted promotion
  aborts as a unit and the original name keeps serving the original data,
  ledger and owners. The retired copy is dropped afterwards. A failure anywhere
  before promotion drops the replacement and leaves the live database
  untouched. The recovery role must be
  a superuser, and the target must exist with a readable owner, before any of
  this starts.
- Both scripts choose the client that matches the server major through
  `scripts/devops/lib/pg-client.sh`: host client when the major matches,
  otherwise the same `pg_dump`/`pg_restore`/`psql` executed inside the
  database container, otherwise a fail-closed error naming `PG_CLIENT_CONTAINER`.
  An archive written by a newer client is not loadable into an older server
  (`SET transaction_timeout`), so the version pairing is enforced, never assumed.

### 5. Deployment configuration

- `deploy/dokploy/docker-compose.prod.yml` defines `db-prod` with a named
  volume, no published ports, a `pg_isready` healthcheck, and the same resource
  envelope as the staging stack. `web-prod` starts after it reports healthy.
- `deploy/dokploy/db-init/10-app-role.sh` creates the non-superuser
  application role from `APP_DB_PASSWORD` on first initialization.
- Bootstrap credentials are isolated: `POSTGRES_DB`/`POSTGRES_USER`/
  `POSTGRES_PASSWORD`/`APP_DB_PASSWORD` live in `deploy/dokploy/.env.prod.db`,
  which only `db-prod` mounts. `web-prod` mounts `.env.prod`, which carries the
  internal application URLs and no bootstrap or recovery credential; a contract
  test renders both files and fails if a forbidden key reaches the web service.
- The env templates carry the internal URLs and keep the Auth block unchanged.

### 6. Provisioning order (runbook)

BRAWUKA-1011 executes this after the code gates:

1. Provision: deploy `db-prod` with an empty volume; confirm the app role
   (non-superuser, no `CREATEDB`) and PostGIS exist. Wait for the **TCP**
   health probe; the first backup starts only after it reports healthy.
2. Pre-migration snapshot: `backup.sh --env prod --type db` against the fresh
   database (proves credentials and the backup path before any DDL). It holds no
   application schema, so it restores only as an empty-schema baseline; it is
   never the smoke or drill sample for the seeded contract.
3. Migrations: `DATABASE_URL=<prod> npm run db:migrate` (0001–0033).
4. Env switch: set `DATABASE_URL`/`DIRECT_URL` in the prod env to the internal
   service; export `PROD_RESTORE_URL` in the operator shell with the authorized
   recovery role (never in the compose env file).
5. Scratch smoke: `restore.sh --env staging --file <migrated, seeded archive>
   --drill` restores as the recovery role, normalizes ownership to the app
   role, and verifies PostGIS, rows and the spatial query; the app smoke suite
   follows once web-prod is deployed (BRAWUKA-500).
6. Backup/restore evidence: one real `backup.sh --env prod` to R2 and one
   `restore.sh` drill recorded on the issue.
7. Rollback: `restore.sh --env prod --file <pre-migration snapshot> --recreate
   --yes`, which builds and verifies a replacement database, then promotes it
   atomically.
   In-place `pg_restore --clean` is **not** a rollback: it cannot drop the
   PostGIS extension while dependent objects exist and the migration ledger
   survives. The relation-set check (no relation outside the archive) is what
   removes that ledger; the run also compares row counts with the snapshot.
   `rollback-prod.sh` passes `--recreate` for the same reason.

### 7. Upgrade windows

- Server image upgrades are scheduled maintenance: `pg_upgrade` is not part of
  the routine path. The documented path is a dump/restore into a new container
  (`backup.sh` → new volume → `restore.sh`), with the old container kept
  stopped until verification passes.
- Extension/image upgrades follow the same dump/restore sequence; there is no
  in-place major upgrade.

## Rejected options

| Option | Why rejected |
| --- | --- |
| Keep application data on Supabase | Free-tier storage cap, pooler connection mode, and a Data API that exposes every table unless hand-maintained RLS stays complete. The app already bypasses it with `pg`, so it adds cost and surface without benefit. |
| Self-hosted Auth (GoTrue / Better Auth) | BRAWUKA-1014 rejected it: it would re-issue identities, break the UUID contract used by `profiles`/`cafes`/`checkins`, and rewrite the OAuth/PKCE flow for no data-layer gain. Auth stays on Supabase. |
| Move the app to Cloudflare Workers | The data layer is a long-lived `pg` pool with PostGIS queries; Workers isolates need Hyperdrive plus a rewrite of every server action and RSC data path. Not justified by the goal. |
| Split frontend and backend | Adds a network hop and a second deploy unit while the app is a single Next.js container. No scaling requirement forces it. |

## Consequences and risks

| Risk | Mitigation | Residual exposure |
| --- | --- | --- |
| Single-host failure (VPS or its disk) | Nightly `pg_dump` → R2 offsite, GFS retention, verified restore drill; stack config archived into the same R2 prefix | Data loss bounded by the backup interval; the host is a single point of failure until a standby exists |
| Backup path silently broken | `backup.sh` fails closed on client/server skew, non-empty dump, and checksum; the drill runs the real archive | A broken R2 credential surfaces at the first scheduled backup — the alerting path is a Dokploy cron failure webhook |
| Restore takes longer than acceptable | Drill measures the real archive; the runbook restores before any schema rollback | Large dumps restore serially; no PITR (no WAL archiving) |
| Upgrade window | Dump/restore into a new container, old container kept stopped | Downtime equals the restore duration |
| Supabase Auth free-tier inactivity pause | Recorded here only; Auth is exercised by real traffic and CI Auth smoke checks | A paused Auth project would fail logins until restored in the Supabase dashboard; no mitigation infrastructure is added by this decision |

## Verification

- `web/tests/devops/restore-drill.test.ts` — stubbed failure lifecycle, the
  client/server version fail-closed case, and a real Postgres drill of a
  gzip-compressed archive larger than the pipe buffer, plus a live restore.
- `web/tests/devops/db-url-selection.test.ts` — per-environment URL selection
  for `backup.sh`, `restore.sh`, and the migration runner.
- `scripts/devops/backup.sh` executed against the local Postgres with a host
  client newer than the server: it switched to the container client, produced
  a checksummed archive, and that archive passed `restore.sh --drill`.
