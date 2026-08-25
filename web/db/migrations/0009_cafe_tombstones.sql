-- CoffeeMode schema v9 (issue #207 — soft-delete / location tombstones for cafes).
-- Retains location and name when a cafe is deleted so /api/cafes/[id]/recovery
-- can serve nearby alternatives on the 404 recovery page (DG111/DG112).

alter table cafes add column if not exists deleted_at timestamptz default null;
create index if not exists idx_cafes_deleted_at on cafes (deleted_at);
