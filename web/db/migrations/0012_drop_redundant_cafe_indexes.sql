-- CoffeeMode schema v12 (issue #228 — tombstone lifecycle review follow-ups).
-- Drops two redundant cafe indexes:
--   idx_cafes_deleted_at (0009): full index on the soft-delete column; the repo
--     convention for tombstone filtering is partial `where deleted_at is null`.
--   idx_cafes_active (0011): partial index on the primary-key column; PK lookups
--     already serve every `where id = ...` query, so it only adds write overhead.

drop index if exists idx_cafes_deleted_at;
drop index if exists idx_cafes_active;
