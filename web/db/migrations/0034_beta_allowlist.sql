-- CafeMood schema v34 (BRAWUKA-970 — closed-beta admission).
--
-- The product is in closed beta: only invited accounts may reach it. This
-- table is the ONLY authoritative roster. It lives in the application
-- database; Supabase Auth keeps its own user store (ADR-0010 §1), so nothing
-- here may assume the auth schema is reachable — no SQL hook reads it.
--
-- Two independent requirements gate one person:
--
--   1. Supabase project setting: "Allow new users to sign up" is OFF, and the
--      operator provisions each invited address in Supabase Auth (dashboard
--      "Add user", or `scripts/beta-allowlist.mjs add` when
--      SUPABASE_SECRET_KEY is configured). An unprovisioned Google account
--      cannot be created at all — Supabase answers the provider callback with
--      `error_code=signup_disabled`, which the app routes to the refusal page.
--   2. This roster, read by the web app (`lib/db/beta.ts`) at session
--      establishment, in `guard()` for every API route, and in the proxy for
--      every page. Revoking a row refuses the next request even while the
--      Supabase account still exists.
--
-- Provisioning is a precondition for signing in, not a grant: the app never
-- admits an address that is not in this table. Rows are never deleted by the
-- app: `revoked_at` retires an address and keeps the audit trail. Operator
-- writes go through `web/scripts/beta-allowlist.mjs`.
create table if not exists beta_allowlist (
  -- Lowercased at write; the CHECK keeps a mixed-case row from ever existing.
  email      text primary key,
  note       text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint beta_allowlist_email_lowercase check (email = lower(email)),
  constraint beta_allowlist_email_shape check (
    email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

-- Reads are always "is this live address present"; the partial index keeps a
-- revoked row from widening the probe.
create index if not exists idx_beta_allowlist_live on beta_allowlist (email)
  where revoked_at is null;
