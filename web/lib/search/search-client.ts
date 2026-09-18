import { responseMessage } from "@/lib/http";
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
  if (city) params.set("city", city);
  if (typeof lat === "number") params.set("lat", String(lat));
  if (typeof lng === "number") params.set("lng", String(lng));
  if (typeof limit === "number") params.set("limit", String(limit));
  if (filters) filtersToSearchParams(filters, params);

  const ranking = getRankingPreference();
  if (ranking) params.set("ranking", ranking);

  const response = await fetch(`/api/search?${params.toString()}`, {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    throw new Error(await responseMessage(response, "search_failed"));
  }
  return (await response.json()) as SearchResponse;
}
