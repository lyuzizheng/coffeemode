-- CoffeeMode schema v4 (issue #24 — likes_count sync trigger).
-- Apply with: psql "$DATABASE_URL" -f 0004_checkin_likes_trigger.sql
-- Depends on: 0002_checkins_and_indexes.sql (checkins.likes_count, checkin_likes)

-- Keep checkins.likes_count in sync with checkin_likes on EVERY mutation
-- path: the app's toggle CTE, cascade deletes (user or checkin removal), and
-- any future code that writes checkin_likes directly. Previously only the
-- toggleCheckInLike CTE maintained the counter, so deleting a user (which
-- cascades checkin_likes) or a manual DELETE left likes_count stale.

create or replace function sync_checkin_likes_count() returns trigger
language plpgsql as $$
begin
  update checkins
    set likes_count = (select count(*)::int from checkin_likes where checkin_id = coalesce(new.checkin_id, old.checkin_id))
  where id = coalesce(new.checkin_id, old.checkin_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_checkin_likes_sync on checkin_likes;
create trigger trg_checkin_likes_sync
  after insert or delete on checkin_likes
  for each row
  execute function sync_checkin_likes_count();

-- The toggle CTE and this trigger count by checkin_id; the unique
-- (user_id, checkin_id) index cannot serve that filter.
create index if not exists idx_checkin_likes_checkin_id on checkin_likes (checkin_id);

-- Heal existing drift once, before the trigger starts protecting the counter.
update checkins c
set likes_count = (select count(*)::int from checkin_likes l where l.checkin_id = c.id);
