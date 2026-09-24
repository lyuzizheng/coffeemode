-- CoffeeMode POI cache service — close BRAWUKA-459 (S1-P3).
-- `0002_poi_cache_expiry.sql` added `expires_at` as a nullable column. A NULL
-- row is invisible to reads (`expires_at > now()` is never true for NULL) and
-- immune to the purge (`expires_at <= now()` is never true for NULL either),
-- so it is unreadable and undeletable. Writers always set the column
-- (`store.ts` denormalize falls back to `computeExpiresAt`), so only abnormal
-- writes can reach the NULL state — but nothing prevented or healed it.
--
-- This migration backfills any NULL rows from `fetched_at + 30 days` (the same
-- expression 0002 used) and then enforces NOT NULL. D1/SQLite cannot
-- `ALTER COLUMN ... SET NOT NULL`, so the constraint is applied with the
-- documented 12-step table rebuild (new table, copy, drop, rename); the
-- primary key and both indexes are recreated with their original names.
-- Idempotent: safe to re-run (CREATE TABLE/INDEX use IF NOT EXISTS and the
-- INSERT selects only rows missing from the new table).

UPDATE pois
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', fetched_at, '+30 days')
WHERE expires_at IS NULL;

CREATE TABLE IF NOT EXISTS pois_new (
  place_id        TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('google', 'apple')),
  name            TEXT NOT NULL,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  address         TEXT,
  types           TEXT NOT NULL DEFAULT '[]',
  business_status TEXT,
  hours_json      TEXT,
  fetched_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);

INSERT INTO pois_new
  (place_id, source, name, lat, lng, address, types, business_status, hours_json, fetched_at, expires_at)
SELECT place_id, source, name, lat, lng, address, types, business_status, hours_json, fetched_at, expires_at
FROM pois
WHERE NOT EXISTS (SELECT 1 FROM pois_new WHERE pois_new.place_id = pois.place_id);

DROP TABLE pois;

ALTER TABLE pois_new RENAME TO pois;

CREATE INDEX IF NOT EXISTS idx_pois_name ON pois (name);
CREATE INDEX IF NOT EXISTS idx_pois_lat_lng ON pois (lat, lng);
CREATE INDEX IF NOT EXISTS idx_pois_expires_at ON pois (expires_at);
