import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { resolveEffectiveCity } from "@/lib/cities";
import { executeSearchCached } from "@/lib/search/search-cache";
import { fixtureSearchResponse, getSearchFixtures, isFixturesEnabled } from "@/lib/search/fixtures";
import { parseSearchQuery, validateSearchQuery } from "@/lib/search/search-params";
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
    const parsed = parseSearchQuery((name) => url.searchParams.get(name));
    const { filters } = parsed;
    const { city } = filters;

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
    // Shared rejection contract (search-params.ts): the SSR /search page maps
    // the same result to an error state, so the two surfaces never drift.
    const valid = validateSearchQuery(parsed);
    if (!valid.ok) {
      return apiError(valid.code, valid.message, { status: valid.status, requestId: ctx.requestId });
    }

    // Resolve effective canonical city ID (DG128 fallback chain when omitted)
    const effectiveCity = resolveEffectiveCity(request.headers, city);

    // BRAWUKA-621: live Google fanout bills per call and the only anonymous
    // brake was forgeable-IP rate limiting — anonymous callers always get
    // stored-only results, so an unauthenticated ?include_live=true can never
    // reach the billed upstream.
    const includeLive = ctx.user ? filters.include_live : false;

    const searchFilters = {
      ...filters,
      city: effectiveCity,
      include_live: includeLive,
      viewer_id: ctx.user?.id,
    };

    // DG137-C: in-process edge cache (city:q:filtersHash; open_now adds a UTC-minute bucket), TTL-bounded
    // and invalidated early when the cafes data version moves.
    const { response: searchResponse, cache } = await executeSearchCached(searchFilters, undefined, ctx.requestId);
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
