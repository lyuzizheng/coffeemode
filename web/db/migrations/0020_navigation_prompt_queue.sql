-- CoffeeMode schema v20 (issue #149 — navigation-prompt slice, DG80/DG91).
-- The return-visit prompt queue columns land on the existing navigations
-- table: `outcome` stores the funnel result, `ask_count` bounds re-asks,
-- `last_asked_at` gates the ≥1-day re-ask delay. idx_nav_pending already
-- covers the unresolved-per-user lookup.
alter table navigations
  add column if not exists outcome text check (outcome in ('visited', 'wont_go', 'not_yet', 'auto')),
  add column if not exists ask_count int not null default 0,
  add column if not exists last_asked_at timestamptz;
