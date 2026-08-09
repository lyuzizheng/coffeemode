/**
 * Persistence: KV hot cache (raw Google responses) + D1 durable store.
 * All D1 rows round-trip through normalize() so handlers see POI objects.
 */

import { CACHE_TTL_SECONDS, DEFAULT_SEARCH_RADIUS_KM, SEARCH_RESULT_LIMIT } from "./constants";
import type { D1Like, KVLike, POI, POISearchHit } from "./types";
import { haversineKm, kmPerDegLat, kmPerDegLng } from "./geo";

const RAW_PREFIX = "raw:google:";

// --- KV hot cache ---

export async function kvGetRaw(kv: KVLike, placeId: string): Promise<string | null> {
  return kv.get(`${RAW_PREFIX}${placeId}`);
}

export function kvPutRaw(kv: KVLike, placeId: string, raw: unknown): Promise<void> {
  return kv.put(`${RAW_PREFIX}${placeId}`, JSON.stringify(raw), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
}

// --- D1 durable store ---

const UPSERT_SQL = `
INSERT INTO pois (place_id, source, name, lat, lng, address, types, business_status, hours_json, photo_refs, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(place_id) DO UPDATE SET
  source = excluded.source,
  name = excluded.name,
  lat = excluded.lat,
  lng = excluded.lng,
  address = excluded.address,
  types = excluded.types,
  business_status = excluded.business_status,
  hours_json = excluded.hours_json,
  photo_refs = excluded.photo_refs,
  fetched_at = excluded.fetched_at
`;

interface POIRow {
  place_id: string;
  source: "google" | "apple";
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  types: string;
  business_status: string | null;
  hours_json: string | null;
  photo_refs: string;
  fetched_at: string;
}

export function normalizeRow(row: POIRow): POI {
  return {
    place_id: row.place_id,
    source: row.source,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    address: row.address,
    types: JSON.parse(row.types) as string[],
    business_status: row.business_status,
    hours_json: row.hours_json,
    photo_refs: JSON.parse(row.photo_refs) as string[],
    fetched_at: row.fetched_at,
  };
}

export function denormalize(poi: POI): unknown[] {
  return [
    poi.place_id,
    poi.source,
    poi.name,
    poi.lat,
    poi.lng,
    poi.address,
    JSON.stringify(poi.types),
    poi.business_status,
    poi.hours_json,
    JSON.stringify(poi.photo_refs),
    poi.fetched_at,
  ];
}

export async function d1UpsertPOI(db: D1Like, poi: POI): Promise<void> {
  await db.prepare(UPSERT_SQL).bind(...denormalize(poi)).run();
}

/** Atomic multi-row upsert in one round-trip via D1 batch(). */
export async function d1UpsertPOIs(db: D1Like, pois: POI[]): Promise<void> {
  if (pois.length === 0) return;
  await db.batch(pois.map((poi) => db.prepare(UPSERT_SQL).bind(...denormalize(poi))));
}

export async function d1GetPOI(db: D1Like, placeId: string): Promise<POI | null> {
  const row = await db
    .prepare("SELECT * FROM pois WHERE place_id = ?")
    .bind(placeId)
    .first<POIRow>();
  return row ? normalizeRow(row) : null;
}

export function isFresh(poi: POI, now = Date.now()): boolean {
  const fetched = Date.parse(poi.fetched_at);
  if (Number.isNaN(fetched)) return false;
  return now - fetched < CACHE_TTL_SECONDS * 1000;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Search stored POIs: optional name LIKE match, optional bounding-box
 * prefilter around (lat,lng), then exact haversine distance filter/sort.
 * Capped at SEARCH_RESULT_LIMIT rows.
 */
export async function d1SearchPOIs(
  db: D1Like,
  opts: { q?: string; lat?: number; lng?: number; radiusKm?: number },
): Promise<POISearchHit[]> {
  const { q, lat, lng } = opts;
  const radiusKm = opts.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM;

  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push(`name LIKE ? ESCAPE '\\'`);
    binds.push(`%${escapeLike(q)}%`);
  }
  if (lat !== undefined && lng !== undefined) {
    const dLat = radiusKm / kmPerDegLat();
    const dLng = radiusKm / kmPerDegLng(lat);
    where.push("lat BETWEEN ? AND ?");
    binds.push(lat - dLat, lat + dLat);
    where.push("lng BETWEEN ? AND ?");
    binds.push(lng - dLng, lng + dLng);
  }
  if (where.length === 0) {
    // Full scan is only reachable with both q and radius unset — caller blocks this.
    return [];
  }

  // Pull more than the final cap because the bounding-box prefilter is loose;
  // the exact haversine filter and sort happen in memory.
  const sql = `SELECT * FROM pois WHERE ${where.join(" AND ")} ORDER BY name ASC LIMIT ${SEARCH_RESULT_LIMIT * 10}`;
  const { results } = await db.prepare(sql).bind(...binds).all<POIRow>();

  let hits: POISearchHit[] = results.map((r) => normalizeRow(r));
  if (lat !== undefined && lng !== undefined) {
    hits = hits
      .map((h) => ({ ...h, distance_km: haversineKm(lat, lng, h.lat, h.lng) }))
      .filter((h) => h.distance_km! <= radiusKm)
      .sort((a, b) => a.distance_km! - b.distance_km!);
  }
  return hits.slice(0, SEARCH_RESULT_LIMIT);
}
