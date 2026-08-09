/**
 * POI cache service types.
 *
 * POI / POISource / POISearchHit come from `web/shared/places/types.ts`
 * — the single source of truth shared with the web app (issue #26).
 * This file keeps only environment-specific structural interfaces.
 */

import type { POI, POISearchHit, POISource } from "../../web/shared/places/types";

export type { POI, POISearchHit, POISource };

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
