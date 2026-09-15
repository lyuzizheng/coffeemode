-- CoffeeMode POI cache service — degrade D1/KV to bounded 30d cache
-- Issue BRAWUKA-294: add expires_at, backfill existing rows, purge expired, drop photo_refs

ALTER TABLE pois ADD COLUMN expires_at TEXT;

UPDATE pois SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', fetched_at, '+30 days');

DELETE FROM pois WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

ALTER TABLE pois DROP COLUMN photo_refs;
