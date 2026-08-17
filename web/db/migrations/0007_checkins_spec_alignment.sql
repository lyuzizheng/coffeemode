-- CoffeeMode schema v7 (issue #36 — reconcile checkins indexes with spec 0001).
-- Apply with: psql "$DATABASE_URL" -f 0007_checkins_spec_alignment.sql
-- Depends on: 0001_init.sql, 0002_checkins_and_indexes.sql (deleted_at,
--             likes_count, checkin_likes)

-- 1. checkins indexes: spec 0001:168-172 pins visited_at-ordered partial
--    indexes (deleted_at is null). The 0001/0002 versions ordered by
--    created_at and lacked the predicate; 0002's idx_checkins_user_visited
--    matched the spec semantically but not by name.
--    Verified against live queries: recomputeWorkStats filters
--    `cafe_id + deleted_at is null order by visited_at desc` and
--    incrementalUpdateWorkStats filters `cafe_id + user_id + deleted_at is
--    null order by visited_at desc, created_at desc` (web/lib/stats/aggregate.ts).
drop index if exists idx_checkins_cafe;          -- was (cafe_id, created_at desc), no predicate
drop index if exists idx_checkins_user_cafe;     -- was (user_id, cafe_id, created_at desc), no predicate
drop index if exists idx_checkins_user_visited;  -- renamed to the spec name below

create index if not exists idx_checkins_cafe
  on checkins (cafe_id, visited_at desc) where deleted_at is null;
create index if not exists idx_checkins_user
  on checkins (user_id, visited_at desc) where deleted_at is null;
create index if not exists idx_checkins_user_cafe
  on checkins (user_id, cafe_id, visited_at desc) where deleted_at is null;
create index if not exists idx_checkins_likes
  on checkins (cafe_id, likes_count desc, visited_at desc) where deleted_at is null;

-- idx_checkins_photos (gin) already exists (0002) and matches the spec.
-- idx_checkins_deleted_at (0002) is additive beyond the spec — kept.

-- 2. checkin_likes unique constraint in spec order (checkin_id, user_id):
--    checkin_id leads so the hot `count(*) ... where checkin_id = ?` (toggle
--    CTE in web/lib/db/checkins.ts + the 0004 sync trigger) can use the
--    backing index's leftmost column. The toggle CTE's user_id+checkin_id
--    equality lookups are served by either order, so nothing regresses.
--    Existing rows cannot violate the new constraint (the old one already
--    forbade the same duplicate pairs).
alter table checkin_likes
  drop constraint if exists checkin_likes_user_id_checkin_id_key,
  add constraint checkin_likes_checkin_id_user_id_key unique (checkin_id, user_id);
