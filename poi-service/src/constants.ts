/** Shared limits and TTLs for the POI cache service (single source of truth). */

import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_EXTERNAL_BATCH_SIZE,
  MAX_SEARCH_RADIUS_KM,
} from "../../web/shared/places/constants";

export { DEFAULT_SEARCH_RADIUS_KM, MAX_EXTERNAL_BATCH_SIZE, MAX_SEARCH_RADIUS_KM };

/** Maximum number of rows /poi/search will ever return. */
export const SEARCH_RESULT_LIMIT = 100;

/** KV hot cache TTL and the D1 "fresh" window are the same by design:
 *  a row younger than this is served without hitting Google. */
export const CACHE_TTL_SECONDS = 7 * 24 * 3600; // ~7d

/**
 * DG144 / DG52 — Category allowlist for D1/KV persistence.
 * Only food/cafe-category external POIs are persisted.
 */
export const FOOD_CAFE_TYPES: Record<string, true> = {
  cafe: true,
  coffee_shop: true,
  bakery: true,
  restaurant: true,
  food: true,
  bar: true,
  meal_delivery: true,
  meal_takeaway: true,
  tea_house: true,
  bubble_tea_store: true,
  espresso_bar: true,
  pastry_shop: true,
  sandwich_shop: true,
  ice_cream_shop: true,
  dessert_shop: true,
  dessert_restaurant: true,
  diner: true,
  bistro: true,
  fast_food_restaurant: true,
  cafeteria: true,
  food_court: true,
};

export function isFoodOrCafePOI(types?: string[] | null): boolean {
  if (!types || types.length === 0) return false;
  return types.some((t) => Boolean(FOOD_CAFE_TYPES[t.toLowerCase()]));
}
