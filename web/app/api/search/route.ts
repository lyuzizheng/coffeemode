import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  CAFES_READ_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { executeSearch } from "@/lib/search/search-service";
import type { SearchFilters } from "@/lib/search/types";
import {
  MAX_STAY_VALUES,
  MIN_SPEND_VALUES,
  type MaxStay,
  type MinSpend,
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

function parseMinSpend(value: string | null): MinSpend | undefined {
  if (!value) return undefined;
  return MIN_SPEND_VALUES.includes(value as MinSpend) ? (value as MinSpend) : undefined;
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
 * Search endpoint merging own cafes and saved POIs with nomad filters (DG44–DG58).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const city = url.searchParams.get("city")?.trim() || undefined;
  const lat = parseNumber(url.searchParams.get("lat"));
  const lng = parseNumber(url.searchParams.get("lng"));
  const openNow = parseBoolean(url.searchParams.get("open_now"));
  const filterWifi = parseScoreFilter(url.searchParams.get("filter_wifi"));
  const filterOutlets = parseScoreFilter(url.searchParams.get("filter_outlets"));
  const filterSeats = parseScoreFilter(url.searchParams.get("filter_seats"));
  const filterTemp = parseScoreFilter(url.searchParams.get("filter_temp"));
  const filterCoffee = parseScoreFilter(url.searchParams.get("filter_coffee"));
  const filterOverall = parseScoreFilter(url.searchParams.get("filter_overall"));
  const filterMinSpend = parseMinSpend(url.searchParams.get("filter_min_spend"));
  const filterMaxStay = parseMaxStay(url.searchParams.get("filter_max_stay"));
  const limitParam = parseNumber(url.searchParams.get("limit"));

  // Validate coordinates if provided
  if (lat !== undefined && (lat < -90 || lat > 90)) {
    return NextResponse.json(
      { error: "invalid_request", message: "lat must be within [-90, 90]" },
      { status: 400 },
    );
  }
  if (lng !== undefined && (lng < -180 || lng > 180)) {
    return NextResponse.json(
      { error: "invalid_request", message: "lng must be within [-180, 180]" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `search:${clientId}`,
    CAFES_READ_RATE_LIMIT.windowMs,
    CAFES_READ_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  const filters: SearchFilters = {
    q,
    city,
    lat,
    lng,
    open_now: openNow,
    filter_wifi: filterWifi,
    filter_outlets: filterOutlets,
    filter_seats: filterSeats,
    filter_temp: filterTemp,
    filter_coffee: filterCoffee,
    filter_overall: filterOverall,
    filter_min_spend: filterMinSpend,
    filter_max_stay: filterMaxStay,
    limit: limitParam,
  };

  try {
    const data = await executeSearch(filters);
    return NextResponse.json(data);
  } catch (err) {
    console.error("/api/search GET failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
