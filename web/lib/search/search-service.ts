import "server-only";

import { DEFAULT_CITY, findCity } from "@/lib/cities";
import { searchCafesInDb } from "@/lib/db/search";
import { searchPOIs } from "@/lib/places/poi-client";
import type { POI } from "@shared/places/types";
import { haversineDistanceM } from "./distance";
import { hasWorkFiltersActive, matchesAllFilters } from "./filter";
import type {
  SearchFilters,
  SearchReferencePoint,
  SearchResponse,
  SearchResultItem,
} from "./types";

const DEFAULT_SUGGESTION_LIMIT = 10;
const WEAK_RESULTS_THRESHOLD = 3;

function resolveReferencePoint(
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

  const city = findCity(cityQuery) ?? DEFAULT_CITY;
  return {
    lat: city.center.lat,
    lng: city.center.lng,
    is_from_city_center: true,
    city_id: city.id,
    city_name: city.name,
  };
}

function scoreRelevance(name: string, q?: string): number {
  if (!q) return 0;
  const lowerName = name.toLowerCase();
  const lowerQ = q.toLowerCase().trim();
  if (lowerName === lowerQ) return 100;
  if (lowerName.startsWith(lowerQ)) return 50;
  if (lowerName.includes(lowerQ)) return 20;
  return 0;
}

export async function executeSearch(
  filters: SearchFilters,
): Promise<SearchResponse> {
  const refPoint = resolveReferencePoint(filters.lat, filters.lng, filters.city);

  const cityInfo = findCity(filters.city);
  const cityScope = cityInfo ? cityInfo.id : filters.city;

  // 1. Fetch own cafes from Postgres
  const cafes = await searchCafesInDb({
    q: filters.q,
    city: cityScope,
    limit: 100,
  });

  // 2. Filter own cafes by work stats & open_now
  const filteredCafes = cafes.filter((cafe) => matchesAllFilters(cafe, filters));

  // 3. Build set of known place_ids to dedupe against POI cache (DG45)
  const existingPlaceIds = new Set<string>();
  for (const cafe of cafes) {
    if (cafe.google_place_id) existingPlaceIds.add(cafe.google_place_id);
    if (cafe.apple_poi_id) existingPlaceIds.add(cafe.apple_poi_id);
  }

  // 4. Fetch saved POIs if no work-stat filters active (POIs don't have work stats)
  let savedPois: POI[] = [];
  const workFiltersActive = hasWorkFiltersActive(filters);

  if (!workFiltersActive && !filters.open_now && (filters.q || !refPoint.is_from_city_center)) {
    try {
      const poiResponse = await searchPOIs({
        q: filters.q,
        lat: refPoint.lat,
        lng: refPoint.lng,
      });
      if (poiResponse && Array.isArray(poiResponse.results)) {
        savedPois = poiResponse.results;
      }
    } catch {
      // POI service unavailable or not configured \u2014 graceful fallback to own cafes
    }
  }

  // 5. Merge and deduplicate (own cafe wins over saved POI \u2014 DG45)
  const items: SearchResultItem[] = [];

  for (const cafe of filteredCafes) {
    const dist = haversineDistanceM(refPoint.lat, refPoint.lng, cafe.lat, cafe.lng);
    items.push({
      id: cafe.id,
      type: "cafe",
      name: cafe.name,
      address: cafe.address,
      lat: cafe.lat,
      lng: cafe.lng,
      distance_m: dist,
      is_from_city_center: refPoint.is_from_city_center,
      cafe,
    });
  }

  for (const poi of savedPois) {
    if (existingPlaceIds.has(poi.place_id)) {
      continue;
    }
    const dist = haversineDistanceM(refPoint.lat, refPoint.lng, poi.lat, poi.lng);
    items.push({
      id: `poi_${poi.place_id}`,
      type: "poi",
      name: poi.name,
      address: poi.address,
      lat: poi.lat,
      lng: poi.lng,
      distance_m: dist,
      is_from_city_center: refPoint.is_from_city_center,
      poi,
    });
  }

  // 6. Sort results: relevance first if q given, then distance (DG58)
  items.sort((a, b) => {
    if (filters.q) {
      const relA = scoreRelevance(a.name, filters.q);
      const relB = scoreRelevance(b.name, filters.q);
      if (relA !== relB) return relB - relA;
    }
    return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
  });

  const totalCount = items.length;
  const isWeakResults = totalCount < WEAK_RESULTS_THRESHOLD;
  const limit = Math.min(filters.limit ?? DEFAULT_SUGGESTION_LIMIT, 50);
  const results = items.slice(0, limit);

  return {
    results,
    total_count: totalCount,
    is_weak_results: isWeakResults,
    reference_point: refPoint,
  };
}
