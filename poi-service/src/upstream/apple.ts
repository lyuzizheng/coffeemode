import { isGoogleFoodOrCafePOI } from "./google";

/**
 * BRAWUKA-328 — Apple MapKit `PointOfInterestCategory` → food/cafe allowlist.
 * Apple's taxonomy is disjoint from Google's (`Cafe` vs `cafe`/`coffee_shop`).
 * Food/drink venues only: Cafe, Restaurant, Bakery, FoodMarket (Google `food`
 * equivalent), Brewery/Distillery/Winery + Nightlife (Google `bar`
 * equivalent). Everything else (Bank, Hotel, Store, …) and unknown/empty
 * categories fail closed — same as the Google matcher.
 *
 * Lives next to its Google sibling in `upstream/` rather than `constants.ts`
 * so both vendor allowlists share one directory (BRAWUKA-327 review).
 */
export const APPLE_FOOD_CAFE_CATEGORIES: Record<string, true> = {
  bakery: true,
  brewery: true,
  cafe: true,
  distillery: true,
  foodmarket: true,
  nightlife: true,
  restaurant: true,
  winery: true,
};

export function isAppleFoodOrCafePOI(types?: string[] | null): boolean {
  if (!types || types.length === 0) return false;
  return types.some((t) => Boolean(APPLE_FOOD_CAFE_CATEGORIES[t.toLowerCase()]));
}

/**
 * Source-aware food/cafe gate for persistence (DG144/DG52). Google entries
 * keep `isGoogleFoodOrCafePOI` semantics; Apple entries go through the MapKit
 * category map above. `getUpstreamProvider("apple")` returns null by design
 * (no server-side Apple upstream), so the Apple arm cannot go through
 * `provider.matchesCategory` — this dispatch is the seam BRAWUKA-327's
 * interface leaves for it. Unknown sources never match.
 */
export function matchesFoodCategory(source: string, types?: string[] | null): boolean {
  if (source === "apple") return isAppleFoodOrCafePOI(types);
  if (source === "google") return isGoogleFoodOrCafePOI(types);
  return false;
}
