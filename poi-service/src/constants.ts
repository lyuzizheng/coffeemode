/** Shared limits and TTLs for the POI cache service (single source of truth). */

import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
} from "../../web/shared/places/constants";

export { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM };

/** Maximum number of rows /poi/search will ever return. */
export const SEARCH_RESULT_LIMIT = 100;

/** Maximum entries accepted in one POST /poi/external request. */
export const MAX_EXTERNAL_BATCH_SIZE = 100;

/** KV hot cache TTL and the D1 "fresh" window are the same by design:
 *  a row younger than this is served without hitting Google. */
export const CACHE_TTL_SECONDS = 7 * 24 * 3600; // ~7d
