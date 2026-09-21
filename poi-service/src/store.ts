/**
 * Persistence: KV hot cache (normalized POI records) + D1 bounded cache.
 * All D1 rows round-trip through normalize() so handlers see POI objects.
 */

import {
  CACHE_TTL_SECONDS,
  DEFAULT_SEARCH_RADIUS_KM,
  POI_EXPIRY_SECONDS,
  SEARCH_RESULT_LIMIT,
} from "./constants";
import type { D1Like, KVLike, POI, POISearchHit } from "./types";
import { haversineKm, kmPerDegLat, kmPerDegLng, wrapLng } from "./geo";

const POI_PREFIX = "poi:";

// --- KV hot cache ---

export async function kvGetPOI(kv: KVLike, placeId: string): Promise<string | null> {
  return kv.get(`${POI_PREFIX}${placeId}`);
}

export async function kvPutPOI(kv: KVLike, poi: POI): Promise<void> {
  await kv.put(`${POI_PREFIX}${poi.place_id}`, JSON.stringify(poi), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
}

/**
 * Drop the KV hot-cache entry for a place id. Called after D1 writes so a
 * stale payload (up to CACHE_TTL_SECONDS old) can never shadow the fresh
 * D1 row on the next GET /poi/:place_id (BRAWUKA-283 P2-1). Deleting a
 * missing key is a no-op in both real KV and the test fake.
 */
export function kvDeletePOI(kv: KVLike, placeId: string): Promise<void> {
  return kv.delete(`${POI_PREFIX}${placeId}`);
}

// --- D1 bounded cache ---

export function computeExpiresAt(fetchedAt: string): string {
  const fetched = Date.parse(fetchedAt);
  const base = Number.isNaN(fetched) ? Date.now() : fetched;
  return new Date(base + POI_EXPIRY_SECONDS * 1000).toISOString();
}

const UPSERT_SQL = `
INSERT INTO pois (place_id, source, name, lat, lng, address, types, business_status, hours_json, fetched_at, expires_at)
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
  fetched_at = excluded.fetched_at,
  expires_at = excluded.expires_at
`;

const PURGE_EXPIRED_SQL =
  "DELETE FROM pois WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

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
  fetched_at: string;
  expires_at: string;
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
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
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
    poi.fetched_at,
    poi.expires_at ?? computeExpiresAt(poi.fetched_at),
  ];
}

export async function d1UpsertPOI(db: D1Like, poi: POI): Promise<void> {
  await db.batch([
    db.prepare(UPSERT_SQL).bind(...denormalize(poi)),
    db.prepare(PURGE_EXPIRED_SQL),
  ]);
}

/** Atomic multi-row upsert in one round-trip via D1 batch(). */
export async function d1UpsertPOIs(db: D1Like, pois: POI[]): Promise<void> {
  if (pois.length === 0) return;
  const stmts = pois.map((poi) => db.prepare(UPSERT_SQL).bind(...denormalize(poi)));
  stmts.push(db.prepare(PURGE_EXPIRED_SQL));
  await db.batch(stmts);
}

export async function d1GetPOI(db: D1Like, placeId: string): Promise<POI | null> {
  const row = await db
    .prepare(
      "SELECT * FROM pois WHERE place_id = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
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
    // Antimeridian (issue #38): a plain [lo, hi] interval misses rows across
    // ±180° — split into two OR-ed intervals with wrapped bounds. When the box
    // spans every longitude (near-pole search, dLng ≥ 180) skip the prefilter
    // entirely; the haversine post-filter stays authoritative either way.
    const lo = lng - dLng;
    const hi = lng + dLng;
    if (dLng >= 180) {
      // no lng prefilter
    } else if (lo < -180 || hi > 180) {
      where.push("(lng BETWEEN ? AND ? OR lng BETWEEN ? AND ?)");
      binds.push(wrapLng(lo), 180, -180, wrapLng(hi));
    } else {
      where.push("lng BETWEEN ? AND ?");
      binds.push(lo, hi);
    }
  }
  if (where.length === 0) {
    // Full scan is only reachable with both q and radius unset — caller blocks this.
    return [];
  }

  where.push("expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");

  // Pull more than the final cap because the bounding-box prefilter is loose;
  // the exact haversine filter and sort happen in memory. When coordinates
  // are present the prefetch MUST order by a distance proxy — ordering by
  // name truncates the candidate set alphabetically and drops nearby POIs
  // once a dense area exceeds the prefetch cap (BRAWUKA-395 P2-3). The proxy
  // is an equirectangular approximation; MIN(|dlng|, 360-|dlng|) keeps the
  // antimeridian wrap correct, and the haversine pass stays authoritative.
  const orderBy =
    lat !== undefined && lng !== undefined
      ? `ORDER BY ABS(lat - ?) * ${kmPerDegLat()} + MIN(ABS(lng - ?), 360 - ABS(lng - ?)) * ${kmPerDegLng(lat)} ASC`
      : "ORDER BY name ASC";
  const sql = `SELECT * FROM pois WHERE ${where.join(" AND ")} ${orderBy} LIMIT ${SEARCH_RESULT_LIMIT * 10}`;
  if (lat !== undefined && lng !== undefined) binds.push(lat, lng, lng);
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
