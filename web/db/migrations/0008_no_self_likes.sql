-- CoffeeMode schema v8 (issue #107 — self-likes are not allowed).
-- Apply with: psql "$DATABASE_URL" -f 0008_no_self_likes.sql
-- Depends on: 0002_checkins_and_indexes.sql (checkin_likes), 0004_checkin_likes_trigger.sql (sync trigger)

-- The app toggle gates the insert on `caller <> checkins.user_id`, but the
-- rule used to exist nowhere at the DB level: an author could like their own
-- note through any write path, inflating the hot-rank signal (spec 0001:262)
-- and the reserved social_weight hook (spec 0004 decision 8). Owner decision
-- (2026-08-18): self-likes are not allowed.
--
-- This migration (a) removes rows written before the rule and (b) makes the
-- rule a DB invariant for EVERY writer, not just the toggle CheckIn CTE.

-- 1. Heal: delete pre-existing self-likes (the rule takes effect retroactively).
delete from checkin_likes l
using checkins c
where c.id = l.checkin_id
  and c.user_id = l.user_id;

-- 2. Invariant: BEFORE INSERT trigger rejects self-likes at the DB level.
--    The app guard keeps the toggle a single atomic statement; this trigger
--    covers direct SQL, future code paths, and anything that skips the lib.
create or replace function reject_self_like() returns trigger
language plpgsql as $$
declare
  author_id uuid;
begin
  select user_id into author_id from checkins where id = new.checkin_id;
  if author_id is not null and new.user_id = author_id then
    raise exception 'self-likes are not allowed (check-in %)', new.checkin_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_checkin_likes_no_self on checkin_likes;
create trigger trg_checkin_likes_no_self
  before insert on checkin_likes
  for each row
  execute function reject_self_like();
