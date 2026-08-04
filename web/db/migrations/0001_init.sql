-- CoffeeMode schema v1 (spec 0001 — 4 tables, deliberately minimal).
-- Apply with: psql "$DATABASE_URL" -f 0001_init.sql
-- PostGIS required (Neon supports it; enable before running).

create extension if not exists postgis;

-- 1. profiles: app-side user record, keyed by Supabase auth user id
create table if not exists profiles (
  id            uuid primary key,        -- = Supabase auth.users.id
  display_name  text not null,
  avatar_url    text,
  current_city  text default 'singapore',
  last_location geography(POINT, 4326),
  last_seen_at  timestamptz,
  created_at    timestamptz default now()
);

-- 2. cafes: CoffeeMode's own POI database
create table if not exists cafes (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique,
  name            text not null,
  location        geography(POINT, 4326) not null,
  address         text,
  city            text default 'singapore',
  description     text,
  cover           text,                   -- R2 key
  gallery         jsonb default '[]',     -- [{key, w, h, by, at}]
  opening_hours   jsonb,                  -- {mon:{open,close},...} + hours_source
  price_range     smallint,               -- 1-4
  google_place_id text,
  apple_poi_id    text,
  created_by      uuid references profiles(id),
  owner_id        uuid references profiles(id),  -- post-MVP owner claim
  work_stats      jsonb default '{}',     -- incremental aggregation cache
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_cafes_location on cafes using gist (location);
create index if not exists idx_cafes_name_fts on cafes using gin (to_tsvector('simple', name));
create unique index if not exists idx_cafes_gplace on cafes (google_place_id) where google_place_id is not null;
create index if not exists idx_cafes_city on cafes (city);

-- 3. checkins: 打卡 — every review is a check-in (creation is the first one)
create table if not exists checkins (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid references cafes(id) on delete cascade,
  user_id     uuid references profiles(id),
  is_creation boolean default false,      -- the check-in that created the cafe
  -- Sliders, all 0-100 decimal, only dimensions the user scored:
  --   wifi, outlets, seats, temp, coffee, overall (personal subjective)
  scores      jsonb not null default '{}',
  -- Policies (nomad essentials):
  min_spend   text,                       -- none | drink | s5 | s10 | s10plus
  max_stay    text,                       -- unlimited | 3h | 2h | 1h | peak
  note        text,
  photos      jsonb default '[]',         -- [{key, w, h}]
  visited_at  timestamptz default now(),
  created_at  timestamptz default now()
);
create index if not exists idx_checkins_cafe on checkins (cafe_id, created_at desc);
create index if not exists idx_checkins_user_cafe on checkins (user_id, cafe_id, created_at desc);

-- 4. navigations: drives the ClassPass-style "did you visit?" prompt
create table if not exists navigations (
  id          uuid primary key default gen_random_uuid(),
  cafe_id     uuid references cafes(id) on delete cascade,
  user_id     uuid references profiles(id),
  resolved    boolean default false,
  created_at  timestamptz default now()
);
create index if not exists idx_nav_pending on navigations (user_id) where resolved = false;
