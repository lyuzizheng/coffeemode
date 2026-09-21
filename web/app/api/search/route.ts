import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { findCity, resolveEffectiveCity } from "@/lib/cities";
import { executeSearchCached } from "@/lib/search/search-cache";
import { fixtureSearchResponse, getSearchFixtures, isFixturesEnabled } from "@/lib/search/fixtures";
import { parseSearchQuery } from "@/lib/search/search-params";
import { appConfig } from "@/lib/config";

/** Private Cache-Control for success responses (DG137-B, values in app.yaml `search.responseCache`). */
const SEARCH_RESPONSE_CACHE_CONTROL = `private, max-age=${appConfig.search.responseCache.maxAgeSeconds}, stale-while-revalidate=${appConfig.search.responseCache.staleWhileRevalidateSeconds}`;
/**
 * GET /api/search
 * Search endpoint merging own cafes and saved POIs with nomad filters (DG44–DG58, DG128, DG129).
 */
export const GET = apiRoute(
  // Search is rate-limited per IP (DG129)
  { bucket: "search", route: "GET /api/search", ipOnly: true },
  async (request, ctx) => {
    const url = new URL(request.url);
    const { filters, rawLimit } = parseSearchQuery((name) => url.searchParams.get(name));
    const { city, lat, lng, limit: limitParam } = filters;

    // DG140: fixtures short-circuit when double-gate is satisfied and ?fixtures=1 requested
    if (isFixturesEnabled() && url.searchParams.get("fixtures") === "1") {
      const fixtures = getSearchFixtures();
      if (fixtures) {
        const response = NextResponse.json(fixtureSearchResponse(fixtures));
        response.headers.set("Cache-Control", SEARCH_RESPONSE_CACHE_CONTROL);
        response.headers.set("X-Search-Mode", "stored_only");
        return response;
      }
    }
    if (lat !== undefined && (lat < -90 || lat > 90)) {
      return apiError("invalid_request", "lat must be within [-90, 90]", { status: 400, requestId: ctx.requestId });
    }
    if (lng !== undefined && (lng < -180 || lng > 180)) {
      return apiError("invalid_request", "lng must be within [-180, 180]", { status: 400, requestId: ctx.requestId });
    }

    // Validate limit if provided: non-numeric or non-positive integer -> 400
    if (rawLimit !== null && rawLimit.trim() !== "" && limitParam === undefined) {
      return apiError("invalid_request", "limit must be a positive integer", { status: 400, requestId: ctx.requestId });
    }
    if (limitParam !== undefined && (!Number.isInteger(limitParam) || limitParam <= 0)) {
      return apiError("invalid_request", "limit must be a positive integer", { status: 400, requestId: ctx.requestId });
    }

    // DG128: explicit city must be known; reject unknown explicit cities without silent re-anchoring
    if (city !== undefined && !findCity(city)) {
      return apiError("invalid_request", "unknown city", { status: 400, requestId: ctx.requestId });
    }

    // Resolve effective canonical city ID (DG128 fallback chain when omitted)
    const effectiveCity = resolveEffectiveCity(request.headers, city);

    const searchFilters = {
      ...filters,
      city: effectiveCity,
      viewer_id: ctx.user?.id,
    };

    // DG137-C: in-process edge cache keyed by city:q:filtersHash, TTL-bounded
    // and invalidated early when the cafes data version moves.
    const { response: searchResponse, cache } = await executeSearchCached(searchFilters);
    const { search_mode, ...body } = searchResponse;
    const response = NextResponse.json(body);
    // DG137-B: Cache-Control on success path only
    response.headers.set("Cache-Control", SEARCH_RESPONSE_CACHE_CONTROL);
    // DG132: observability header for actual stored vs live fanout mode
    response.headers.set("X-Search-Mode", search_mode ?? "stored_only");
    response.headers.set("X-Search-Cache", cache);
    return response;
  },
);
