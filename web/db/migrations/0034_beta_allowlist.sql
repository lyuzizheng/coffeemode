-- CafeMood schema v34 (BRAWUKA-970 — closed-beta admission).
--
-- The product is in closed beta: only invited accounts may sign in. Two layers
-- read this table, and neither is optional (spec 0001 §Auth, §Closed beta):
--
--   1. `beta_before_user_created` — the Supabase Auth `before-user-created`
--      hook body. Enabled in the Supabase dashboard (Authentication → Hooks);
--      while the hook is not installed, every sign-up that reaches Supabase
--      succeeds and layer 2 is what refuses the account (it also signs the
--      session back out, so nothing usable is left behind).
--   2. The web app (`lib/db/beta.ts`) at session establishment, in `guard()`
--      for every API route, and in the proxy for every page.
--
-- Rows are never deleted by the app: `revoked_at` retires an address and keeps
-- the audit trail. Operator writes go through `web/scripts/beta-allowlist.mjs`.
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

-- before-user-created hook body (Supabase Auth → Hooks → "Before user created").
-- The hook receives `{"user": {...}}` and must return `{}` to allow the
-- sign-up; raising an exception rejects it before any auth row exists.
-- SECURITY DEFINER because the hook runs as `supabase_auth_admin`, which has no
-- grant on this table.
create or replace function beta_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if candidate = '' then
    raise exception 'closed beta: sign-up carries no email address'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from beta_allowlist
    where email = candidate and revoked_at is null
  ) then
    raise exception 'closed beta: % is not on the beta allowlist', candidate
      using errcode = '42501';
  end if;
  return '{}'::jsonb;
end;
$$;

-- Supabase-only grants: the auth role exists in Supabase Postgres and in the
-- local Supabase CLI stack, never in the compose PostGIS kit or Neon. Guarding
-- keeps one migration file valid on every environment.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant select on beta_allowlist to supabase_auth_admin';
    execute 'grant execute on function beta_before_user_created(jsonb) to supabase_auth_admin';
  end if;
end
$$;
