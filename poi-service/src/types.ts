/** Shared types for the POI cache service. */

export type POISource = "google" | "apple";

/** Normalized POI record — the D1 durable store shape. */
export interface POI {
  place_id: string;
  source: POISource;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  types: string[];
  business_status: string | null;
  /** Raw JSON of Google regularOpeningHours (or null). */
  hours_json: string | null;
  /** Photo references (Google photo.name values / Apple refs). */
  photo_refs: string[];
  fetched_at: string; // ISO 8601
}

/** Minimal structural interfaces so tests can inject fakes
 *  while real Cloudflare bindings satisfy them at runtime. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedLike;
  /** Execute several prepared statements atomically in one round-trip.
   *  Matches Cloudflare D1's batch() API. */
  batch(statements: D1PreparedLike[]): Promise<Array<{ meta: { changes: number } }>>;
}

export interface Env {
  POI_SERVICE_TOKEN: string;
  GOOGLE_PLACES_API_KEY: string;
  POI_KV: KVLike;
  POI_DB: D1Like;
  /** Overridable for tests; defaults to https://places.googleapis.com */
  GOOGLE_PLACES_BASE_URL?: string;
}

export interface Deps {
  fetchImpl: typeof fetch;
}

export interface POISearchHit extends POI {
  distance_km?: number;
}
