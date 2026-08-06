-- CoffeeMode POI cache service — D1 schema (slice poi-cache-service)
-- Apply:  wrangler d1 migrations apply poi-store --local   (dev)
--         wrangler d1 migrations apply poi-store --remote  (prod)

CREATE TABLE IF NOT EXISTS pois (
  place_id        TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('google', 'apple')),
  name            TEXT NOT NULL,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  address         TEXT,
  types           TEXT NOT NULL DEFAULT '[]',
  business_status TEXT,
  hours_json      TEXT,
  photo_refs      TEXT NOT NULL DEFAULT '[]',
  fetched_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pois_name ON pois (name);
CREATE INDEX IF NOT EXISTS idx_pois_lat_lng ON pois (lat, lng);