import "server-only";

import { appConfig } from "@/lib/config";
import { DEFAULT_CITY, findCity } from "@/lib/cities";
import { haversineDistanceM } from "@shared/places/geo";
import {
  fetchCafesForSearch,
  fetchLivePredictions,
  fetchStoredPois,
  resolvePoiQuery,
} from "./search-branches";
import type {
  SearchFilters,
  SearchReferencePoint,
  SearchResultItem,
  SearchResultSource,
  SearchServiceResponse,
} from "./types";
import type { POI, PlacePrediction } from "@shared/places/types";

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

export type SearchCacheField = "hit" | "miss" | "bypass";

/**
 * The single `search.telemetry` JSON line (ADR-0005 frozen fields).
 * `executeSearch` emits it for every real execution; the /api/search route
 * re-emits it for edge-cache hits so hit/miss ratios stay measurable.
 */
export function emitSearchTelemetry(fields: {
  mode: "stored_only" | "live";
  durationMs: number;
  truncated: boolean;
  poiDegraded: boolean;
  cache: SearchCacheField;
}): void {
  console.info("search.telemetry", {
    "search.requests": { mode: fields.mode },
    "search.duration_ms": fields.durationMs,
    "search.truncated": fields.truncated,
    // Always 0 post-pushdown (DG145-C): the open_now_share derivation is
    // dead — kept so the field contract stays stable (ADR-0005 amendment).
    "search.open_now.batches": 0,
    "search.poi_degraded": fields.poiDegraded,
    "search.cache": fields.cache,
  });
}

export async function executeSearch(
  filters: SearchFilters,
  instant?: Date,
  cacheStatus: SearchCacheField = "bypass",
  requestId?: string,
): Promise<SearchServiceResponse> {
  const startTime = performance.now();
  const refPoint = resolveReferencePoint(filters.lat, filters.lng, filters.city);

  // The three branches are mutually independent: POI dedup runs after all
  // three settle, so they fan out concurrently — total latency is the max
  // of the branches, not the sum (BRAWUKA-281 P1).
  const poiQuery = resolvePoiQuery(filters);
  const wantLive = poiQuery !== null && Boolean(filters.include_live);

  const [cafeRes, storedRes, liveRes] = await Promise.all([
    fetchCafesForSearch(filters, instant),
    poiQuery !== null
      ? fetchStoredPois(poiQuery, refPoint, requestId)
      : Promise.resolve({ results: [] as POI[], failed: false }),
    wantLive && poiQuery !== null
      ? fetchLivePredictions(poiQuery, refPoint, requestId)
      : Promise.resolve({ predictions: [] as PlacePrediction[], session: "", failed: false }),
  ]);
  const { rawCafes, filteredCafes } = cafeRes;

  const warnings: string[] = [];
  let actualSearchMode: "stored_only" | "live" = "stored_only";

  if (storedRes.failed) warnings.push("poi_unavailable");
  if (wantLive) {
    actualSearchMode = "live";
    if (liveRes.failed) warnings.push("live_poi_unavailable");
  }

  const rawPois: POI[] = [...storedRes.results];

  const existingPlaceIds = new Set<string>();
  for (const cafe of rawCafes) {
    if (cafe.google_place_id) existingPlaceIds.add(cafe.google_place_id);
    if (cafe.apple_poi_id) existingPlaceIds.add(cafe.apple_poi_id);
  }

  // DG134: external source toggle (Apple gated until MapKit ready)
  const externalSources = appConfig.search.externalSources;
  const sourceEnabled = (source: string): boolean => {
    if (!externalSources) return true;
    if (source === "google") return externalSources.google;
    if (source === "apple") return externalSources.apple;
    return true;
  };

  // Deduplicate POIs: own cafes always win (DG45)
  const dedupedPois = rawPois.filter(
    (poi) => sourceEnabled(poi.source) && !existingPlaceIds.has(poi.place_id),
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

  // Live Autocomplete predictions (BRAWUKA-602). They carry no coordinates,
  // so `lat`/`lng` stay null and the distance comes from Google's own
  // `distanceMeters` (measured from the reference point we biased with).
  // Deduped against own cafes and stored POIs, which are the richer records.
  const livePredictions =
    wantLive && !liveRes.failed && sourceEnabled("google") ? liveRes.predictions : [];
  const seenIds = new Set<string>([
    ...existingPlaceIds,
    ...dedupedPois.map((poi) => poi.place_id),
  ]);
  for (const prediction of livePredictions) {
    if (seenIds.has(prediction.place_id)) continue;
    seenIds.add(prediction.place_id);
    items.push({
      id: prediction.place_id,
      type: "poi",
      source: "google",
      name: prediction.name,
      address: prediction.address,
      lat: null,
      lng: null,
      distance_m: prediction.distance_meters ?? null,
      is_from_city_center: refPoint.is_from_city_center,
      prediction,
      prediction_session: liveRes.session,
    });
  }

  // DG131: conditional low-relevance truncation — only when q non-empty & at least one >= minRelevanceScore
  let filteredItems = items;
  const qTrim = filters.q?.trim() ?? "";
  if (qTrim !== "") {
    const minScore = appConfig.search.minRelevanceScore;
    const hasHigh = items.some((it) => scoreRelevance(it.name, filters.q) >= minScore);
    if (hasHigh) {
      filteredItems = items.filter((it) => scoreRelevance(it.name, filters.q) >= minScore);
    }
  }

  // Sort results: relevance (+ DG136 good_first boost) first, then distance, then name, then id (DG142)
  const effectiveRanking = filters.ranking ?? appConfig.search.rankingMode;
  const isGoodFirst = effectiveRanking === "good_first";
  const { experienceMin, compositeMin, boost } = appConfig.search.goodFirst;
  const goodFirstBoost = (stats: { experience_score: number | null; composite_score: number | null } | null | undefined): number =>
    isGoodFirst && stats != null && ((stats.experience_score != null && stats.experience_score >= experienceMin) || (stats.composite_score != null && stats.composite_score >= compositeMin)) ? boost : 0;
  filteredItems.sort((a, b) => {
    const boostA = goodFirstBoost(a.cafe?.work_stats);
    const boostB = goodFirstBoost(b.cafe?.work_stats);
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
  emitSearchTelemetry({
    mode: actualSearchMode,
    durationMs,
    truncated,
    poiDegraded,
    cache: cacheStatus,
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
