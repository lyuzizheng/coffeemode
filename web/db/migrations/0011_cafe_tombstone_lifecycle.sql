-- CoffeeMode schema v11 (issue #219 — cafe tombstone lifecycle gaps).
-- Adjusts unique partial indexes so soft-deleted cafes (tombstones) do not block
-- re-importing or recreating the same Google Place / Apple POI id.

drop index if exists idx_cafes_gplace;
create unique index if not exists idx_cafes_gplace on cafes (google_place_id)
where google_place_id is not null and deleted_at is null;

drop index if exists idx_cafes_apple_poi_id;
create unique index if not exists idx_cafes_apple_poi_id on cafes (apple_poi_id)
where apple_poi_id is not null and deleted_at is null;

-- Partial index for active cafes (consistent with deleted_at convention)
create index if not exists idx_cafes_active on cafes (id) where deleted_at is null;
