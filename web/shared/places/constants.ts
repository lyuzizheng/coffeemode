/**
 * Search-radius constants — single source of truth (issue #26).
 *
 * `DEFAULT_SEARCH_RADIUS_KM` is the product default (spec 0001: 10 km
 * nearby search) and is used by both the web proxy and the POI worker.
 * `MAX_SEARCH_RADIUS_KM` is the worker's hard bounding-box ceiling for
 * direct API callers; the web proxy enforces its own stricter product cap
 * of 10 km in `web/lib/places/constants.ts`.
 */
export const DEFAULT_SEARCH_RADIUS_KM = 10;

/** Worker-level bounding-box ceiling (km) — keeps bounding boxes sane. */
export const MAX_SEARCH_RADIUS_KM = 200;

/** Maximum number of external POIs accepted in a single batch request (issue #232). */
export const MAX_EXTERNAL_BATCH_SIZE = 50;
