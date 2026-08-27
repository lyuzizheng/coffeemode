import "server-only";

import { appConfig } from "@/lib/config";
import { DEFAULT_CITY, findCity } from "@/lib/cities";
import { searchCafesInDb } from "@/lib/db/search";
import { searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";
import { haversineDistanceM } from "./distance";
import { hasWorkFiltersActive, matchesAllFilters } from "./filter";
import type {
  SearchFilters,
  SearchReferencePoint,
  SearchResponse,
  SearchResultItem,
} from "./types";
import type { POI } from "@shared/places/types";

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
): Promise<SearchResponse> {
  const refPoint = resolveReferencePoint(filters.lat, filters.lng, filters.city);

  // 1. Fetch matching cafes from DB
  const rawCafes = await searchCafesInDb({
    q: filters.q,
    city: filters.city,
    limit: appConfig.search.dbFetchCap,
  });

  // Filter cafes against work attributes and open_now
  const filteredCafes = rawCafes.filter((cafe) =>
    matchesAllFilters(cafe, filters, instant),
  );

  const existingPlaceIds = new Set<string>();
  for (const cafe of rawCafes) {
    if (cafe.google_place_id) existingPlaceIds.add(cafe.google_place_id);
    if (cafe.apple_poi_id) existingPlaceIds.add(cafe.apple_poi_id);
  }

  // 2. Fetch POIs if no active work filters and keyword is given
  const hasWorkFilters = hasWorkFiltersActive(filters);
  let rawPois: POI[] = [];

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
    }

    if (filters.include_live) {
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
            }
          }
        }
      } catch (err) {
        console.error("search-service: live POI search error", err);
      }
    }
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

    const source =
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

  // Sort results: relevance first, then distance
  items.sort((a, b) => {
    const relA = scoreRelevance(a.name, filters.q);
    const relB = scoreRelevance(b.name, filters.q);
    if (relA !== relB) return relB - relA;

    if (a.distance_m !== null && b.distance_m !== null) {
      return a.distance_m - b.distance_m;
    }
    if (a.distance_m !== null) return -1;
    if (b.distance_m !== null) return 1;
    return a.name.localeCompare(b.name);
  });

  const total_count = items.length;
  const is_weak_results = total_count < appConfig.search.weakResultsThreshold;

  // DG46: Top 10 suggestions, strictly capped
  const limit = Math.min(
    filters.limit ?? appConfig.search.defaultSuggestionLimit,
    appConfig.search.maxSuggestionLimit,
  );

  const results = items.slice(0, Math.max(0, limit));

  return {
    results,
    total_count,
    is_weak_results,
    reference_point: refPoint,
  };
}
