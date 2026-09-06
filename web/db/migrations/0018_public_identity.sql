-- CoffeeMode schema v18 (issue #139 — opt-in public author identity consent).
alter table profiles
  add column if not exists show_public_identity bool not null default false,
  add column if not exists public_handle text,
  add column if not exists identity_consented_at timestamptz,
  add column if not exists public_handle_changed_at timestamptz;

create unique index if not exists idx_profiles_public_handle on profiles (public_handle)
  where public_handle is not null;
