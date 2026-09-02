import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { findCity, resolveEffectiveCity } from "@/lib/cities";
import { executeSearch } from "@/lib/search/search-service";
import { getSearchFixtures, isFixturesEnabled } from "@/lib/search/fixtures";
import { WORK_DIM_FILTER_MAP } from "@/lib/search/filter";
import type { SearchFilters, SearchResultItem, SearchResultSource } from "@/lib/search/types";
import {
  MAX_STAY_VALUES,
  type MaxStay,
} from "@/types/checkins";

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseScoreFilter(value: string | null): number | undefined {
  const num = parseNumber(value);
  if (num === undefined) return undefined;
  if (num < 0 || num > 100) return undefined;
  return num;
}

function parseMaxStay(value: string | null): MaxStay | undefined {
  if (!value) return undefined;
  return MAX_STAY_VALUES.includes(value as MaxStay) ? (value as MaxStay) : undefined;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value === "true" || value === "1";
}

/**
 * GET /api/search
 * Search endpoint merging own cafes and saved POIs with nomad filters (DG44–DG58, DG128, DG129).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const city = url.searchParams.get("city")?.trim() || undefined;
  const lat = parseNumber(url.searchParams.get("lat"));
  const lng = parseNumber(url.searchParams.get("lng"));
  const openNow = parseBoolean(url.searchParams.get("open_now"));
  const includeLive = parseBoolean(url.searchParams.get("include_live"));
  const filterMaxStay = parseMaxStay(url.searchParams.get("filter_max_stay"));
  const rawLimit = url.searchParams.get("limit");
  const limitParam = parseNumber(rawLimit);
  const rawRanking = url.searchParams.get("ranking")?.trim();
  const ranking = rawRanking === "good_first" || rawRanking === "relevance" ? rawRanking : undefined;

  // DG140: fixtures short-circuit when double-gate is satisfied and ?fixtures=1 requested
  if (isFixturesEnabled() && url.searchParams.get("fixtures") === "1") {
    const fixtures = getSearchFixtures();
    if (fixtures) {
      const results: SearchResultItem[] = [
        ...fixtures.cafes.map((cafe) => ({
          id: cafe.id,
          type: "cafe" as const,
          source: "coffeemode" as const,
          name: cafe.name,
          address: cafe.address,
          lat: cafe.lat,
          lng: cafe.lng,
          distance_m: null,
          is_from_city_center: false,
          cafe,
        })),
        ...fixtures.pois.map((poi) => ({
          id: poi.place_id,
          type: "poi" as const,
          source: (poi.search_source ?? (poi.source === "apple" ? "apple" : "stored_poi")) as SearchResultSource,
          name: poi.name,
          address: poi.address,
          lat: poi.lat,
          lng: poi.lng,
          distance_m: null,
          is_from_city_center: false,
          poi,
        })),
      ];
      const response = NextResponse.json({
        results,
        total_count: results.length,
        is_weak_results: results.length < 3,
        reference_point: {
          lat: 1.285,
          lng: 103.85,
          is_from_city_center: false,
          city_id: "singapore",
          city_name: "Singapore",
        },
      });
      response.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
      response.headers.set("X-Search-Mode", "stored_only");
      return response;
    }
  }
  if (lat !== undefined && (lat < -90 || lat > 90)) {
    return apiError("invalid_request", "lat must be within [-90, 90]", 400);
  }
  if (lng !== undefined && (lng < -180 || lng > 180)) {
    return apiError("invalid_request", "lng must be within [-180, 180]", 400);
  }

  // Validate limit if provided: non-numeric or non-positive integer -> 400
  if (rawLimit !== null && rawLimit.trim() !== "" && limitParam === undefined) {
    return apiError("invalid_request", "limit must be a positive integer", 400);
  }
  if (limitParam !== undefined && (!Number.isInteger(limitParam) || limitParam <= 0)) {
    return apiError("invalid_request", "limit must be a positive integer", 400);
  }

  // DG128: explicit city must be known; reject unknown explicit cities without silent re-anchoring
  if (city !== undefined && !findCity(city)) {
    return apiError("invalid_request", "unknown city", 400);
  }

  // Resolve effective canonical city ID (DG128 fallback chain when omitted)
  const effectiveCity = resolveEffectiveCity(request.headers, city);

  // Search is rate-limited per IP (DG129)
  const clientId = getClientIdentifier(request, null);
  const rate = await checkRateLimit(
    "search",
    clientId,
    rateLimitBuckets("search"),
    "GET /api/search",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  const filters: SearchFilters = {
    q,
    city: effectiveCity,
    lat,
    lng,
    open_now: openNow,
    include_live: includeLive,
    filter_max_stay: filterMaxStay,
    limit: limitParam,
    ranking,
  };

  // Populate work dimension score filters using shared mapping table
  for (const { key } of WORK_DIM_FILTER_MAP) {
    const val = parseScoreFilter(url.searchParams.get(key));
    if (val !== undefined) {
      filters[key] = val;
    }
  }

  try {
    const { search_mode, ...searchResponse } = await executeSearch(filters);
    const response = NextResponse.json(searchResponse);
    // DG137-B: Cache-Control on success path only
    response.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
    // DG132: observability header for actual stored vs live fanout mode
    response.headers.set("X-Search-Mode", search_mode ?? "stored_only");
    return response;
  } catch (err) {
    console.error("/api/search GET failed", err);
    return apiError("internal_error", 500);
  }
}
