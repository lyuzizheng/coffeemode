import { WORK_DIM_FILTER_MAP } from "./filter";
import { filtersToSearchParams, type SearchFilterState } from "./search-filters";
import type { SearchFilters } from "./types";

/**
 * Canonical `?q&city&filter_*` serialization — the write half of the DG48
 * deep-link contract (spec 0001 §Search). Neutral module (no server-only):
 * the SSR page, the API route, and the map panel's client code all build
 * URLs from this one serializer so parameter names can never drift.
 */

/** Inverse of `parseSearchQuery`: canonical `?q&city&filter_*` serialization.
 * The SSR page builds chip-remove hrefs and form hidden fields from this so
 * every link it emits stays inside the shared parameter contract. */
export function serializeSearchParams(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.city) params.set("city", filters.city);
  if (filters.lat !== undefined) params.set("lat", String(filters.lat));
  if (filters.lng !== undefined) params.set("lng", String(filters.lng));
  if (filters.open_now !== undefined) params.set("open_now", String(filters.open_now));
  if (filters.filter_max_stay) params.set("filter_max_stay", filters.filter_max_stay);
  if (filters.ranking) params.set("ranking", filters.ranking);
  for (const { key } of WORK_DIM_FILTER_MAP) {
    const val = filters[key];
    if (val !== undefined) params.set(key, String(val));
  }
  return params;
}

/**
 * Canonical `/search` deep link (DG48): the map panel's submitted-results
 * "view all" affordance and the SSR page itself build the same URL —
 * parameter names stay identical by sharing `serializeSearchParams`.
 * `ranking` is explicit: the device-local preference (localStorage, DG136)
 * is read by the caller, never inside the builder. `filters` carries the
 * active nomad-filter state so the deep link preserves it.
 */
export function buildSearchHref({
  q,
  city,
  ranking,
  filters,
}: {
  q?: string;
  city?: string;
  ranking?: string | null;
  filters?: SearchFilterState;
}): string {
  const params = serializeSearchParams({ q: q?.trim() || undefined, city, ranking: ranking ?? undefined });
  if (filters) filtersToSearchParams(filters, params);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}
