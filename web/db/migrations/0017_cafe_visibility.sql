-- CoffeeMode schema v17 (DG147 / issue #229 — cafes.visibility reversible hide).
-- Adds visibility column (default 'public'; existing rows stay public) with CHECK constraint.
-- Updates idx_cafes_location_active gist index predicate to include visibility = 'public'.
alter table cafes
  add column if not exists visibility text not null default 'public' check (visibility in ('public', 'private'));

drop index if exists idx_cafes_location_active;
create index if not exists idx_cafes_location_active on cafes using gist (location)
where deleted_at is null and visibility = 'public';
