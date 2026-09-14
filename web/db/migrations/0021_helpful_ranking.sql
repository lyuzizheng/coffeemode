-- CoffeeMode schema v21 (BRAWUKA-266 / DG148 — daily time-decayed Helpful ranking snapshot).
-- One global run per nightly job execution: the job inserts a `building` run,
-- fills entries with frozen per-check-in inputs, then publishes atomically
-- (supersede old active + activate new in ONE transaction). The partial unique
-- index enforces at most one `active` run; entries cascade on run delete so
-- retention cleanup is a single row delete.
create table if not exists helpful_ranking_runs (
  id           uuid primary key default gen_random_uuid(),
  status       text not null,             -- building | active | superseded
  built_at     timestamptz not null default now(),
  activated_at timestamptz
);
create unique index if not exists helpful_ranking_runs_one_active
  on helpful_ranking_runs ((1)) where status = 'active';

create table if not exists helpful_ranking_entries (
  run_id      uuid not null references helpful_ranking_runs(id) on delete cascade,
  cafe_id     uuid not null,
  checkin_id  uuid not null references checkins(id) on delete cascade,
  score       double precision not null,
  likes_count int not null,
  visited_at  timestamptz not null,
  primary key (run_id, cafe_id, checkin_id)
);
create index if not exists helpful_ranking_entries_read
  on helpful_ranking_entries (run_id, cafe_id, score desc, visited_at desc, checkin_id desc);
