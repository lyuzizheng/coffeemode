#!/bin/sh
# CafeMood web entrypoint — converge the schema before the server starts.
#
# BRAWUKA-690: Dokploy's deploy path only builds and ups the container, so
# web/scripts/migrate.mjs never ran, schema_migrations trailed the repo, and
# queries touching newer columns failed with Postgres 42703 (staging
# cafes.source -> /api/cafes/[id] 500, BRAWUKA-688).
#
# Runs the idempotent runner (schema_migrations ledger + pg_advisory_lock)
# whenever DATABASE_URL is injected — the same env the server itself reads,
# so staging, prod first deploy (BRAWUKA-500), and manual compose runs all
# converge before serving:
#   * DATABASE_URL unset  -> skip; the app serves its documented fail-closed
#     db_unavailable contract (local/CI runs without a database keep working).
#   * migrations fail      -> exit non-zero; a drifted schema is never served
#     (restart: unless-stopped retries, swarm update_config rolls back).
# Works in plain compose and swarm mode alike — no depends_on/ordering needed.
set -eu

if [ -n "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL set — applying pending migrations"
  node scripts/migrate.mjs
else
  echo "[entrypoint] DATABASE_URL not set — skipping migrations"
fi

exec "$@"
