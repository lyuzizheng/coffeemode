-- CoffeeMode schema v23 (BRAWUKA-284 — runtime_config for operator-editable content).
-- `app.yaml` stays build-time config (invariants); this table owns runtime-editable
-- content only: announcement banners (BRAWUKA-424: the `flags` channel was
-- removed — no consumer ever read it). Security/rate-limit/auth
-- parameters MUST NEVER live here (an operator-editable security parameter is no
-- security boundary). Reads go through lib/db/runtime-config.ts; writes are
-- operator SQL (or a future admin-only route), never public API writes.
create table if not exists runtime_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function touch_runtime_config_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_runtime_config_touch on runtime_config;
create trigger trg_runtime_config_touch
  before update on runtime_config
  for each row
  execute function touch_runtime_config_updated_at();
