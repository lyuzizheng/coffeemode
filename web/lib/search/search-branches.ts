import { logError } from "@/lib/observability/server-log";
import "server-only";

import { appConfig } from "@/lib/config";
import { searchCafesInDb } from "@/lib/db/search";
import type { CafeWithExternalIds } from "@/lib/db/search";
import { searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";
import { hasWorkFiltersActive, matchesAllFilters } from "./filter";
import type { SearchFilters, SearchReferencePoint } from "./types";
import type { POI } from "@shared/places/types";

/**
 * DB branch of the search fan-out. All nomad filters — including open_now,
 * pushed down via cafe_is_open_at (DG145-C, migration 0028) — are evaluated
 * in SQL; the in-memory matchesAllFilters pass stays as the shared
 * post-check. Independent of the POI branches — runs concurrently with them
 * inside `executeSearch` (BRAWUKA-281 P1).
 */
export async function fetchCafesForSearch(
  filters: SearchFilters,
  instant?: Date,
): Promise<{
  rawCafes: CafeWithExternalIds[];
  filteredCafes: CafeWithExternalIds[];
}> {
  // Resolve the evaluation instant once so the SQL predicate and the
  // in-memory post-check can never disagree about "now".
  const effectiveInstant = instant ?? new Date();
  const cafes = await searchCafesInDb({
    q: filters.q,
    city: filters.city,
    filter_wifi: filters.filter_wifi,
    filter_outlets: filters.filter_outlets,
    filter_seats: filters.filter_seats,
    filter_temp: filters.filter_temp,
    filter_coffee: filters.filter_coffee,
    filter_overall: filters.filter_overall,
    filter_max_stay: filters.filter_max_stay,
    open_now: filters.open_now,
    instant: effectiveInstant,
    viewerId: filters.viewer_id,
    limit: appConfig.search.dbFetchCap,
  });
  return {
    rawCafes: cafes,
    filteredCafes: cafes.filter((cafe) =>
      matchesAllFilters(cafe, filters, effectiveInstant),
    ),
  };
}

/**
 * Stored-POI branch of the fan-out. Never rejects: failure degrades to an
 * empty list plus a `poi_unavailable` warning (DG133).
 */
export async function fetchStoredPois(
  q: string,
  refPoint: SearchReferencePoint,
  requestId?: string,
): Promise<{ results: POI[]; failed: boolean }> {
  try {
    const poiRes = await searchPOIs(
      {
        q,
        lat: refPoint.lat ?? undefined,
        lng: refPoint.lng ?? undefined,
        r: appConfig.search.maxRadiusKm,
      },
      requestId,
    );
    return { results: poiRes.results ?? [], failed: false };
  } catch (err) {
    logError({ route: "search-service stored POI search", error: err });
    return { results: [], failed: true };
  }
}

/**
 * Live-POI branch of the fan-out. Never rejects: failure degrades to a
 * `live_poi_unavailable` warning (DG133).
 */
export async function fetchLivePois(
  q: string,
  refPoint: SearchReferencePoint,
  requestId?: string,
): Promise<{ results: POI[]; failed: boolean }> {
  try {
    const liveRes = await searchExternalPOIs(
      {
        q,
        lat: refPoint.lat ?? undefined,
        lng: refPoint.lng ?? undefined,
        r: appConfig.search.maxRadiusKm,
      },
      requestId,
    );
    return { results: liveRes?.results ?? [], failed: false };
  } catch (err) {
    logError({ route: "search-service live POI search", error: err });
    return { results: [], failed: true };
  }
}

/** Whether the POI branches participate for these filters (shared gate). */
export function resolvePoiQuery(filters: SearchFilters): string | null {
  const hasWorkFilters = hasWorkFiltersActive(filters);
  if (hasWorkFilters) return null;
  if (!filters.q || filters.q.trim().length < appConfig.search.minPoiQueryLength) return null;
  return filters.q.trim();
}
