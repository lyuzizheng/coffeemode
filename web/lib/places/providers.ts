import type { CreateTranslator, PlaceSearchProvider } from "./place-search";
import { googlePlaceSearch } from "./google-place-search";
import { applePlaceSearch } from "./apple-place-search";

/**
 * The place-search provider registry (owner directive 2026-09-16: geocoding
 * is a replaceable layer). Order is the UI toggle order; adding or swapping
 * a provider is a one-line change here — the creation sheet never names a
 * vendor.
 */
export function getPlaceSearchProviders(
  t: CreateTranslator,
): PlaceSearchProvider[] {
  return [googlePlaceSearch(t), applePlaceSearch(t)];
}
