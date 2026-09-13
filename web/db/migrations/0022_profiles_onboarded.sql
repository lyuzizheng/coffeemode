-- CoffeeMode schema v20 (issue #153 / DG122 — onboarding completion flag).
-- `profiles.onboarded` is the authoritative "welcome card dismissed" record for
-- signed-in users so the card never returns on any device; anonymous visits
-- keep their own flag in localStorage and merge it here on login.
alter table profiles
  add column if not exists onboarded bool not null default false;
