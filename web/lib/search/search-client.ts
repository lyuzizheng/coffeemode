import { findCity } from "@/lib/cities";
import { apiFetch } from "@/lib/http";
import { readOnboardingState } from "@/lib/onboarding-store";
import { getRankingPreference } from "./ranking-preference";
import { filtersToSearchParams, type SearchFilterState } from "./search-filters";
import type { SearchResponse } from "./types";

export interface UnifiedSearchParams {
  q: string;
  city?: string;
  lat?: number;
  lng?: number;
  limit?: number;
  /** Nomad filters (DG44–DG58): open_now + filter_* thresholds + max_stay. */
  filters?: SearchFilterState;
  signal?: AbortSignal;
}

/**
 * Translate the caller's city scope into `?city=`/`?lat&lng` params that stay
 * inside the `/api/search` contract (BRAWUKA-568): `?city=` only accepts
 * launch-city ids — a runtime city id (DG121, e.g. `kuala-lumpur` minted from
 * `cf-ipcity`) would 400 every search. Launch cities send their canonical id;
 * runtime/unknown cities drop `city` and scope by coordinates instead —
 * caller-provided lat/lng first, then the stored `lastLocation` fix that the
 * locate flow persists alongside the runtime id. With neither, both params
 * are omitted and the server resolves scope from request headers (DG128).
 */
export function resolveSearchScope(
  city?: string,
  lat?: number,
  lng?: number,
): { city?: string; lat?: number; lng?: number } {
  if (city) {
    const known = findCity(city);
    if (known) return { city: known.id, lat, lng };
  } else {
    return { lat, lng };
  }
  // Unknown/runtime city: prefer a complete caller coordinate pair, then the
  // stored fix — never mix halves from different sources.
  if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
  const stored = readOnboardingState()?.lastLocation;
  if (stored) return { lat: stored.lat, lng: stored.lng };
  return {};
}

/**
 * Client for `GET /api/search` (map-independent unified search, DG44–DG58).
 * Pure transport: results stay in server order — grouping is a render-layer
 * concern (`grouped-results.ts`, DG131) and this client never re-sorts.
 *
 * DG136: when the user has chosen a ranking preference it is appended as
 * `?ranking=good_first|relevance`; when unset (anonymous, never touched the
 * toggle) the parameter is omitted and the server default applies.
 */
export async function fetchUnifiedSearch({
  q,
  city,
  lat,
  lng,
  limit,
  filters,
  signal,
}: UnifiedSearchParams): Promise<SearchResponse> {
  const params = new URLSearchParams({ q });
  const scope = resolveSearchScope(city, lat, lng);
  if (scope.city) params.set("city", scope.city);
  if (typeof scope.lat === "number") params.set("lat", String(scope.lat));
  if (typeof scope.lng === "number") params.set("lng", String(scope.lng));
  if (typeof limit === "number") params.set("limit", String(limit));
  if (filters) filtersToSearchParams(filters, params);

  const ranking = getRankingPreference();
  if (ranking) params.set("ranking", ranking);

  return apiFetch<SearchResponse>(`/api/search?${params.toString()}`, {
    method: "GET",
    signal,
  });
}

// `buildSearchHref` lives in `search-url.ts` — the neutral module that owns
// the canonical `?q&city&filter_*` serialization for both server and client.
