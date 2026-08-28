-- CoffeeMode schema v14 (issue #244 — FK cascade indexes, partial GiST, and drop inert GIN).
-- 1. Foreign key indexes to eliminate sequential scans on cascade deletes
create index if not exists idx_checkin_likes_user_id on checkin_likes (user_id);
create index if not exists idx_navigations_cafe_id on navigations (cafe_id);
create index if not exists idx_image_upload_intents_user_id on image_upload_intents (user_id);

-- 2. Partial GiST spatial index on active cafes (omits tombstones)
drop index if exists idx_cafes_location;
create index if not exists idx_cafes_location_active on cafes using gist (location) where deleted_at is null;

-- 3. Drop unused GIN JSONB path indexes that add write overhead without query usage
drop index if exists idx_cafes_gallery;
drop index if exists idx_checkins_photos;
