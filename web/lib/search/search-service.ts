import "server-only";

import { appConfig } from "@/lib/config";
import { DEFAULT_CITY, findCity } from "@/lib/cities";
import { searchCafesInDb } from "@/lib/db/search";
import type { CafeWithExternalIds } from "@/lib/db/search";
import { searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";
import { haversineDistanceM } from "./distance";
import { hasWorkFiltersActive, matchesAllFilters } from "./filter";
import type {
  SearchFilters,
  SearchReferencePoint,
  SearchResultItem,
  SearchResultSource,
  SearchServiceResponse,
} from "./types";
import type { POI } from "@shared/places/types";

export function hasUnpushedFilters(filters: SearchFilters): boolean {
  return Boolean(filters.open_now);
}

export function resolveReferencePoint(
  lat?: number,
  lng?: number,
  cityQuery?: string,
): SearchReferencePoint {
  if (
    lat !== undefined &&
    lng !== undefined &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    return {
      lat,
      lng,
      is_from_city_center: false,
    };
  }

  if (cityQuery) {
    const city = findCity(cityQuery);
    if (city) {
      return {
        lat: city.center.lat,
        lng: city.center.lng,
        is_from_city_center: true,
        city_id: city.id,
        city_name: city.name,
      };
    }
    // Unknown city: do not re-anchor to Singapore; return unanchored reference point
    return {
      lat: null,
      lng: null,
      is_from_city_center: false,
    };
  }

  // No coordinates and no city specified: fall back to default city center
  return {
    lat: DEFAULT_CITY.center.lat,
    lng: DEFAULT_CITY.center.lng,
    is_from_city_center: true,
    city_id: DEFAULT_CITY.id,
    city_name: DEFAULT_CITY.name,
  };
}

function scoreRelevance(name: string, q?: string): number {
  if (!q) return 0;
  const lowerName = name.toLowerCase();
  const lowerQ = q.toLowerCase().trim();
  const { exactNameMatch, prefixMatch, fuzzyMatch, secondaryMatch } =
    appConfig.search.relevanceWeights;
  if (lowerName === lowerQ) return exactNameMatch;
  if (lowerName.startsWith(lowerQ)) return prefixMatch;
  if (lowerName.includes(lowerQ)) return fuzzyMatch;
  return secondaryMatch;
}

export async function executeSearch(
  filters: SearchFilters,
  instant?: Date,
): Promise<SearchServiceResponse> {
  const startTime = performance.now();
  const refPoint = resolveReferencePoint(filters.lat, filters.lng, filters.city);

  const hasUnpushed = hasUnpushedFilters(filters);
  const rawCafes: CafeWithExternalIds[] = [];
  let filteredCafes: CafeWithExternalIds[] = [];
  let openNowBatches = 0;
  let openNowTruncated = false;

  if (!hasUnpushed) {
    // 1. Fetch matching cafes from DB with work filters pushed down to SQL
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
      limit: appConfig.search.dbFetchCap,
    });
    rawCafes.push(...cafes);
    filteredCafes = rawCafes.filter((cafe) =>
      matchesAllFilters(cafe, filters, instant),
    );
  } else {
    // Bounded iterative fetch for queries with in-memory filters (e.g. open_now)
    const targetLimit = Math.max(
      0,
      Math.min(
        filters.limit ?? appConfig.search.defaultSuggestionLimit,
        appConfig.search.maxSuggestionLimit,
      ),
    );
    const batchSize = appConfig.search.dbFetchCap;
    const maxBatches = appConfig.search.maxIterativeFetchBatches;

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
        limit: batchSize,
      });

      rawCafes.push(...cafesBatch);

      const matchingInBatch = cafesBatch.filter((cafe) =>
        matchesAllFilters(cafe, filters, instant),
      );
      filteredCafes.push(...matchingInBatch);

      if (filteredCafes.length >= targetLimit || cafesBatch.length < batchSize) {
        break;
      }
    }

    if (filteredCafes.length < targetLimit && openNowBatches >= maxBatches) {
      openNowTruncated = true;
    }
  }

  const existingPlaceIds = new Set<string>();
  for (const cafe of rawCafes) {
    if (cafe.google_place_id) existingPlaceIds.add(cafe.google_place_id);
    if (cafe.apple_poi_id) existingPlaceIds.add(cafe.apple_poi_id);
  }

  // 2. Fetch POIs if no active work filters and keyword is given
  const hasWorkFilters = hasWorkFiltersActive(filters);
  let rawPois: POI[] = [];
  const warnings: string[] = [];
  let actualSearchMode: "stored_only" | "live" = "stored_only";
  const livePoiIds = new Set<string>();

  if (openNowTruncated) {
    warnings.push("open_now_truncated");
  }

  if (!hasWorkFilters && filters.q && filters.q.trim().length >= appConfig.search.minPoiQueryLength) {
    try {
      const poiRes = await searchPOIs({
        q: filters.q.trim(),
        lat: refPoint.lat ?? undefined,
        lng: refPoint.lng ?? undefined,
        r: appConfig.search.maxRadiusKm,
      });
      rawPois = poiRes.results ?? [];
    } catch (err) {
      console.error("search-service: stored POI search error", err);
      warnings.push("poi_unavailable");
    }

    if (filters.include_live) {
      actualSearchMode = "live";
      try {
        const liveRes = await searchExternalPOIs({
          q: filters.q.trim(),
          lat: refPoint.lat ?? undefined,
          lng: refPoint.lng ?? undefined,
          r: appConfig.search.maxRadiusKm,
        });
        if (liveRes?.results) {
          const storedIds = new Set(rawPois.map((p) => p.place_id));
          for (const livePoi of liveRes.results) {
            if (!storedIds.has(livePoi.place_id)) {
              rawPois.push(livePoi);
              storedIds.add(livePoi.place_id);
              livePoiIds.add(livePoi.place_id);
            }
          }
        }
      } catch (err) {
        console.error("search-service: live POI search error", err);
        warnings.push("live_poi_unavailable");
      }
    }
  }

  // DG134: external source toggle (Apple gated until MapKit ready)
  const externalSources = appConfig.search.externalSources;
  if (externalSources) {
    rawPois = rawPois.filter((poi) => {
      if (poi.source === "google" && !externalSources.google) return false;
      if (poi.source === "apple" && !externalSources.apple) return false;
      return true;
    });
  }

  // Deduplicate POIs: own cafes always win (DG45)
  const dedupedPois = rawPois.filter(
    (poi) => !existingPlaceIds.has(poi.place_id),
  );

  // 3. Assemble SearchResultItem array
  const items: SearchResultItem[] = [];

  for (const cafe of filteredCafes) {
    const distance_m =
      refPoint.lat !== null && refPoint.lng !== null
        ? haversineDistanceM(refPoint.lat, refPoint.lng, cafe.lat, cafe.lng)
        : null;

    items.push({
      id: cafe.id,
      type: "cafe",
      source: "coffeemode",
      name: cafe.name,
      address: cafe.address,
      lat: cafe.lat,
      lng: cafe.lng,
      distance_m,
      is_from_city_center: refPoint.is_from_city_center,
      cafe,
    });
  }

  for (const poi of dedupedPois) {
    const distance_m =
      refPoint.lat !== null && refPoint.lng !== null
        ? haversineDistanceM(refPoint.lat, refPoint.lng, poi.lat, poi.lng)
        : null;

    const source: SearchResultSource =
      poi.source === "google"
        ? "google"
        : poi.source === "apple"
          ? "apple"
          : "stored_poi";
    items.push({
      id: poi.place_id,
      type: "poi",
      source,
      name: poi.name,
      address: poi.address,
      lat: poi.lat,
      lng: poi.lng,
      distance_m,
      is_from_city_center: refPoint.is_from_city_center,
      poi,
    });
  }

  // DG131: conditional low-relevance truncation — only when q non-empty & at least one >= minRelevanceScore
  let filteredItems = items;
  const qTrim = filters.q?.trim() ?? "";
  if (qTrim !== "") {
    const minScore = appConfig.search.minRelevanceScore ?? 50;
    const hasHigh = items.some((it) => scoreRelevance(it.name, filters.q) >= minScore);
    if (hasHigh) {
      filteredItems = items.filter((it) => scoreRelevance(it.name, filters.q) >= minScore);
    }
  }

  // Sort results: relevance (+ DG136 good_first boost) first, then distance, then name, then id (DG142)
  const effectiveRanking = filters.ranking ?? appConfig.search.rankingMode;
  const isGoodFirst = effectiveRanking === "good_first";
  filteredItems.sort((a, b) => {
    const boostA = isGoodFirst && a.cafe ? ((a.cafe.work_stats.experience_score != null && a.cafe.work_stats.experience_score >= 80) || (a.cafe.work_stats.composite_score != null && a.cafe.work_stats.composite_score >= 75) ? 10 : 0) : 0;
    const boostB = isGoodFirst && b.cafe ? ((b.cafe.work_stats.experience_score != null && b.cafe.work_stats.experience_score >= 80) || (b.cafe.work_stats.composite_score != null && b.cafe.work_stats.composite_score >= 75) ? 10 : 0) : 0;
    const relA = scoreRelevance(a.name, filters.q) + boostA;
    const relB = scoreRelevance(b.name, filters.q) + boostB;
    if (relA !== relB) return relB - relA;

    if (a.distance_m !== null && b.distance_m !== null) {
      return a.distance_m - b.distance_m;
    }
    if (a.distance_m !== null) return -1;
    if (b.distance_m !== null) return 1;
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });

  const total_count = filteredItems.length;
  const is_weak_results = total_count < appConfig.search.weakResultsThreshold;

  // DG46: Top 10 suggestions, strictly capped
  const limit = Math.min(
    filters.limit ?? appConfig.search.defaultSuggestionLimit,
    appConfig.search.maxSuggestionLimit,
  );

  const results = filteredItems.slice(0, Math.max(0, limit));

  const durationMs = Math.round(performance.now() - startTime);
  const truncated = total_count > results.length;
  const poiDegraded = warnings.includes("poi_unavailable") || warnings.includes("live_poi_unavailable");
  console.info("search.telemetry", {
    "search.requests": { mode: actualSearchMode },
    "search.duration_ms": durationMs,
    "search.truncated": truncated,
    "search.open_now.batches": openNowBatches,
    ...(openNowTruncated ? { open_now_truncated: true } : {}),
    "search.poi_degraded": poiDegraded,
  });

  return {
    results,
    total_count,
    is_weak_results,
    reference_point: refPoint,
    ...(warnings.length > 0 ? { warnings } : {}),
    search_mode: actualSearchMode,
  };
}
