-- CoffeeMode schema v31 (BRAWUKA-695: runtime city id namespace backfill audit).
-- PM constraint: backfill corrupted launch-city current_city values where
-- last_location is > 50km from the claimed launch city center.
-- Records old -> new in profile_city_backfill_audit before updating profiles.

create table if not exists profile_city_backfill_audit (
  user_id uuid primary key references profiles(id) on delete cascade,
  old_city text not null,
  new_city text not null,
  migrated_at timestamptz not null default now()
);

with launch_targets(city_id, center_point, new_city) as (
  values
    ('singapore', ST_SetSRID(ST_MakePoint(103.8198, 1.3521), 4326)::geography, 'rt-asia-singapore'),
    ('tokyo', ST_SetSRID(ST_MakePoint(139.6503, 35.6762), 4326)::geography, 'rt-asia-tokyo'),
    ('seoul', ST_SetSRID(ST_MakePoint(126.978, 37.5665), 4326)::geography, 'rt-asia-seoul'),
    ('taipei', ST_SetSRID(ST_MakePoint(121.5654, 25.033), 4326)::geography, 'rt-asia-taipei'),
    ('shanghai', ST_SetSRID(ST_MakePoint(121.4737, 31.2304), 4326)::geography, 'rt-asia-shanghai'),
    ('bangkok', ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography, 'rt-asia-bangkok'),
    ('hongkong', ST_SetSRID(ST_MakePoint(114.1694, 22.3193), 4326)::geography, 'rt-asia-hong_kong'),
    ('hong-kong', ST_SetSRID(ST_MakePoint(114.1694, 22.3193), 4326)::geography, 'rt-asia-hong_kong'),
    ('melbourne', ST_SetSRID(ST_MakePoint(144.9631, -37.8136), 4326)::geography, 'rt-australia-melbourne'),
    ('berlin', ST_SetSRID(ST_MakePoint(13.405, 52.52), 4326)::geography, 'rt-europe-berlin'),
    ('london', ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326)::geography, 'rt-europe-london')
),
candidates as (
  select p.id as user_id, p.current_city as old_city, t.new_city
  from profiles p
  join launch_targets t on p.current_city = t.city_id
  where p.last_location is not null
    and ST_Distance(p.last_location, t.center_point) > 50000
)
insert into profile_city_backfill_audit (user_id, old_city, new_city, migrated_at)
select user_id, old_city, new_city, now()
from candidates
on conflict (user_id) do nothing;

update profiles p
set current_city = a.new_city
from profile_city_backfill_audit a
where p.id = a.user_id;
