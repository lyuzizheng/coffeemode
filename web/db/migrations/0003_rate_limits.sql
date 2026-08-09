-- CoffeeMode schema v3 (issue #23 — distributed rate limiting).
-- Apply with: psql "$DATABASE_URL" -f 0003_rate_limits.sql
-- Depends on: 0001_init.sql

-- Distributed token-bucket storage for the web app's API rate limiter.
-- Buckets are shared across all app instances (self-hosted Postgres), so
-- horizontal scaling cannot be used to bypass limits. Each check() is one
-- atomic UPSERT (see web/lib/rate-limit/postgres.ts CHECK_SQL).
create table if not exists rate_limits (
  key          text primary key,
  tokens       double precision not null,
  window_ms    bigint not null,
  max_requests integer not null,
  reset_at     timestamptz not null,
  updated_at   timestamptz not null default now()
);

-- Cleanup scans prune rows whose window has passed.
create index if not exists idx_rate_limits_reset_at on rate_limits (reset_at);
