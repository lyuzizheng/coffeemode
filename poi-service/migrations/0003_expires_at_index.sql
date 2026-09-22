-- CoffeeMode POI cache service — index the scheduled purge scan (BRAWUKA-645).
-- The nightly cron deletes rows via `expires_at <= now()`; without an index
-- that scan is a full table pass. Reads still filter on place_id / name /
-- lat+lng, so no other index changes.

CREATE INDEX IF NOT EXISTS idx_pois_expires_at ON pois (expires_at);
