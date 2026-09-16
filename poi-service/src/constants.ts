/** Shared limits and TTLs for the POI cache service (single source of truth). */

import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_EXTERNAL_BATCH_SIZE,
  MAX_SEARCH_RADIUS_KM,
} from "../../web/shared/places/constants";
import {
  GOOGLE_FOOD_CAFE_TYPES,
  isGoogleFoodOrCafePOI,
} from "./upstream/google";

export { DEFAULT_SEARCH_RADIUS_KM, MAX_EXTERNAL_BATCH_SIZE, MAX_SEARCH_RADIUS_KM };

/** Maximum number of rows /poi/search will ever return. */
export const SEARCH_RESULT_LIMIT = 100;

/** KV hot cache TTL and the D1 "fresh" window are the same by design:
 *  a row younger than this is served without hitting Google. */
export const CACHE_TTL_SECONDS = 7 * 24 * 3600; // ~7d

/**
 * Live Google query-level cache TTL (BRAWUKA-283 P2-2): short on purpose.
 * Repeat searches (two users, retries, a debounce miss) skip the billed
 * upstream call for 10 minutes; fresh enough for a creation entry point.
 */
export const SEARCH_QUERY_CACHE_TTL_SECONDS = 600;

/**
 * DG144 / DG52 — Category allowlist for D1/KV persistence.
 * Re-exported from upstream/google for backwards compatibility.
 */
export const FOOD_CAFE_TYPES = GOOGLE_FOOD_CAFE_TYPES;
export const isFoodOrCafePOI = isGoogleFoodOrCafePOI;
