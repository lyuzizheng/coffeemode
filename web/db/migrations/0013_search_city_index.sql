-- CoffeeMode schema v13 (issue #243 — search performance & lower(city) functional index).
-- Supports case-insensitive city lookups in searchCafesInDb.

create index if not exists idx_cafes_lower_city on cafes (lower(city)) where deleted_at is null;
