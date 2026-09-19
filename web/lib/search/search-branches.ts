import { logError } from "@/lib/observability/server-log";
import "server-only";

import { appConfig } from "@/lib/config";
import { searchCafesInDb } from "@/lib/db/search";
import type { CafeWithExternalIds } from "@/lib/db/search";
import { searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";
import { hasWorkFiltersActive, matchesAllFilters } from "./filter";
import type { SearchFilters, SearchReferencePoint } from "./types";
import type { POI } from "@shared/places/types";

function hasUnpushedFilters(filters: SearchFilters): boolean {
  return Boolean(filters.open_now);
}

/**
 * DB branch of the search fan-out (pushed-down work filters, or the bounded
 * open_now iterative fetch). Independent of the POI branches — runs
 * concurrently with them inside `executeSearch` (BRAWUKA-281 P1).
 */
export async function fetchCafesForSearch(
  filters: SearchFilters,
  instant?: Date,
): Promise<{
  rawCafes: CafeWithExternalIds[];
  filteredCafes: CafeWithExternalIds[];
  openNowBatches: number;
  openNowTruncated: boolean;
}> {
  if (!hasUnpushedFilters(filters)) {
    const cafes = await fetchPushedDownCafes(filters);
    return {
      rawCafes: cafes,
      filteredCafes: cafes.filter((cafe) => matchesAllFilters(cafe, filters, instant)),
      openNowBatches: 0,
      openNowTruncated: false,
    };
  }
  return fetchIterativeCafes(filters, instant);
}

/** Single-shot DB fetch with work filters pushed down to SQL. */
async function fetchPushedDownCafes(filters: SearchFilters): Promise<CafeWithExternalIds[]> {
  return searchCafesInDb({
    q: filters.q,
    city: filters.city,
    filter_wifi: filters.filter_wifi,
    filter_outlets: filters.filter_outlets,
    filter_seats: filters.filter_seats,
    filter_temp: filters.filter_temp,
    filter_coffee: filters.filter_coffee,
    filter_overall: filters.filter_overall,
    filter_max_stay: filters.filter_max_stay,
    viewerId: filters.viewer_id,
    limit: appConfig.search.dbFetchCap,
  });
}

/** Bounded iterative fetch for in-memory filters (e.g. open_now). */
async function fetchIterativeCafes(
  filters: SearchFilters,
  instant?: Date,
): Promise<{
  rawCafes: CafeWithExternalIds[];
  filteredCafes: CafeWithExternalIds[];
  openNowBatches: number;
  openNowTruncated: boolean;
}> {
  const rawCafes: CafeWithExternalIds[] = [];
  const filteredCafes: CafeWithExternalIds[] = [];
  let openNowBatches = 0;
  let openNowTruncated = false;
  const targetLimit = Math.max(
    0,
    Math.min(
      filters.limit ?? appConfig.search.defaultSuggestionLimit,
      appConfig.search.maxSuggestionLimit,
    ),
  );
  const batchSize = appConfig.search.dbFetchCap;
  const maxBatches = appConfig.search.maxIterativeFetchBatches;

  // BRAWUKA-448: LIMIT+1 probe. A full batch is ambiguous — more rows may
  // remain, or the DB may be exactly exhausted. The extra row disambiguates
  // without a second query, so exact exhaustion neither wastes a trailing
  // fetch nor falsely reports truncation.
  let dbExhausted = false;
  for (let batch = 0; batch < maxBatches; batch++) {
    openNowBatches = batch + 1;
    const offset = batch * batchSize;
    const cafesBatch = await searchCafesInDb({
      q: filters.q,
      city: filters.city,
      filter_wifi: filters.filter_wifi,
      filter_outlets: filters.filter_outlets,
      filter_seats: filters.filter_seats,
      filter_temp: filters.filter_temp,
      filter_coffee: filters.filter_coffee,
      filter_overall: filters.filter_overall,
      filter_max_stay: filters.filter_max_stay,
      offset,
      viewerId: filters.viewer_id,
      limit: batchSize + 1,
    });

    const hasMore = cafesBatch.length > batchSize;
    // The probe row only signals remainder — never surface it as a cafe.
    const page = hasMore ? cafesBatch.slice(0, batchSize) : cafesBatch;

    rawCafes.push(...page);

    const matchingInBatch = page.filter((cafe) =>
      matchesAllFilters(cafe, filters, instant),
    );
    filteredCafes.push(...matchingInBatch);

    if (filteredCafes.length >= targetLimit || !hasMore) {
      dbExhausted = !hasMore;
      break;
    }
  }
  if (filteredCafes.length < targetLimit && !dbExhausted) {
    openNowTruncated = true;
  }

  return { rawCafes, filteredCafes, openNowBatches, openNowTruncated };
}

/**
 * Stored-POI branch of the fan-out. Never rejects: failure degrades to an
 * empty list plus a `poi_unavailable` warning (DG133).
 */
export async function fetchStoredPois(
  q: string,
  refPoint: SearchReferencePoint,
): Promise<{ results: POI[]; failed: boolean }> {
  try {
    const poiRes = await searchPOIs({
      q,
      lat: refPoint.lat ?? undefined,
      lng: refPoint.lng ?? undefined,
      r: appConfig.search.maxRadiusKm,
    });
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
): Promise<{ results: POI[]; failed: boolean }> {
  try {
    const liveRes = await searchExternalPOIs({
      q,
      lat: refPoint.lat ?? undefined,
      lng: refPoint.lng ?? undefined,
      r: appConfig.search.maxRadiusKm,
    });
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
