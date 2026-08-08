-- CoffeeMode schema v2 (Phase 1 Part B).
-- Apply with: psql "$DATABASE_URL" -f 0002_checkins_and_indexes.sql
-- Depends on: 0001_init.sql

-- 1. Soft-delete + audit columns on checkins
alter table checkins
  add column if not exists updated_at timestamptz default now(),
  add column if not exists deleted_at  timestamptz;

-- 2. Denormalized like counter (source of truth remains checkin_likes)
alter table checkins
  add column if not exists likes_count int not null default 0;

-- 3. Social signal table for note ranking and future social-weight hook
create table if not exists checkin_likes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete cascade,
  checkin_id  uuid references checkins(id) on delete cascade,
  created_at  timestamptz default now(),
  unique (user_id, checkin_id)
);

-- 4. StoredImage records gain an optional `source` field so gallery queries can
-- hide photos from soft-deleted check-ins. JSONB is schemaless, so this is a
-- conceptual/schema comment change rather than a column migration.
comment on column cafes.gallery is
  'StoredImage[] with optional source:{type:"cafe"|"checkin", id} for provenance';
comment on column checkins.photos is
  'StoredImage[] with optional source:{type:"checkin", id} so deleted check-ins can hide their photos from cafes.gallery';

-- 5. Missing indexes for Phase 1 queries
create index if not exists idx_cafes_created_by on cafes (created_by);
create unique index if not exists idx_cafes_apple_poi_id on cafes (apple_poi_id) where apple_poi_id is not null;
create index if not exists idx_profiles_current_city on profiles (current_city);
create index if not exists idx_checkins_user_visited on checkins (user_id, visited_at desc) where deleted_at is null;
create index if not exists idx_checkins_deleted_at on checkins (deleted_at) where deleted_at is null;

-- GIN indexes for JSONB containment (@>) against image arrays
create index if not exists idx_cafes_gallery on cafes using gin (gallery jsonb_path_ops);
create index if not exists idx_checkins_photos on checkins using gin (photos jsonb_path_ops);
