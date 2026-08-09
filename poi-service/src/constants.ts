/** Shared limits and TTLs for the POI cache service (single source of truth). */

/** Default search radius in kilometres for POI searches. */
export const DEFAULT_SEARCH_RADIUS_KM = 50;

/** Upper bound for the /poi/search radius (km) — keeps bounding boxes sane. */
export const MAX_SEARCH_RADIUS_KM = 200;

/** Maximum number of rows /poi/search will ever return. */
export const SEARCH_RESULT_LIMIT = 100;

/** Maximum entries accepted in one POST /poi/external request. */
export const MAX_EXTERNAL_BATCH_SIZE = 100;

/** KV hot cache TTL and the D1 "fresh" window are the same by design:
 *  a row younger than this is served without hitting Google. */
export const CACHE_TTL_SECONDS = 7 * 24 * 3600; // ~7d
