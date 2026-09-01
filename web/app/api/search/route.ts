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
import { WORK_DIM_FILTER_MAP } from "@/lib/search/filter";
import type { SearchFilters } from "@/lib/search/types";
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

  // Validate coordinates if provided
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
    const data = await executeSearch(filters);
    const response = NextResponse.json(data);
    // DG132: observability header for stored vs live mode
    response.headers.set("X-Search-Mode", filters.include_live ? "live" : "stored_only");
    return response;
  } catch (err) {
    console.error("/api/search GET failed", err);
    return apiError("internal_error", 500);
  }
}
