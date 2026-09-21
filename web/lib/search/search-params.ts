import "server-only";

import { parseQueryBoolean, parseQueryNumber, parseQueryScore } from "@/lib/api/response";
import { findCity } from "@/lib/cities";
import { parseMaxStayFilter } from "@/lib/validation/checkin";
import { WORK_DIM_FILTER_MAP } from "./filter";
import type { SearchFilters, SearchParamError } from "./types";

/**
 * Shared `?q&city&filter_*` parsing for `GET /api/search` and the SSR
 * `/search` page — the deep-link contract (DG48, spec 0001 §Search) lives in
 * exactly one place so the two surfaces can never drift on parameter names
 * or value semantics.
 *
 * Parsing is permissive by design: malformed values drop to `undefined`
 * (absent) rather than throwing. Rejection policy lives in
 * `validateSearchQuery` below — the API maps it to 400s and the SSR page
 * maps it to an error state, so the two surfaces can never drift on what
 * counts as an invalid deep link.
 */
export interface ParsedSearchQuery {
  /** Parsed filters; `city`/`lat`/`lng`/`limit` are the raw (unvalidated) values. */
  filters: SearchFilters;
  /** Raw `limit` string so the API can distinguish absent / blank / invalid. */
  rawLimit: string | null;
}

export function parseSearchQuery(
  get: (name: string) => string | null,
): ParsedSearchQuery {
  const q = get("q")?.trim() || undefined;
  const city = get("city")?.trim() || undefined;
  const lat = parseQueryNumber(get("lat"));
  const lng = parseQueryNumber(get("lng"));
  const openNow = parseQueryBoolean(get("open_now"));
  const includeLive = parseQueryBoolean(get("include_live"));
  const filterMaxStay = parseMaxStayFilter(get("filter_max_stay"));
  const rawLimit = get("limit");
  const limit = parseQueryNumber(rawLimit);
  const rawRanking = get("ranking")?.trim();
  const ranking =
    rawRanking === "good_first" || rawRanking === "relevance" ? rawRanking : undefined;

  const filters: SearchFilters = {
    q,
    city,
    lat,
    lng,
    open_now: openNow,
    include_live: includeLive,
    filter_max_stay: filterMaxStay,
    limit,
    ranking,
  };

  // Work-dimension score thresholds share the route's mapping table.
  for (const { key } of WORK_DIM_FILTER_MAP) {
    const val = parseQueryScore(get(key));
    if (val !== undefined) {
      filters[key] = val;
    }
  }

  return { filters, rawLimit };
}

const SEARCH_PARAM_ERROR_MESSAGES: Record<SearchParamError, string> = {
  lat: "lat must be within [-90, 90]",
  lng: "lng must be within [-180, 180]",
  limit: "limit must be a positive integer",
  city: "unknown city",
};

/**
 * The rejection half of the deep-link contract, shared by `GET /api/search`
 * (400 `invalid_request`) and the SSR `/search` page (error state). Check
 * order matches the API: lat range, lng range, limit, then known city —
 * callers must not reorder or subset it.
 */
export function validateSearchQuery(
  parsed: ParsedSearchQuery,
): { ok: true } | { ok: false; error: SearchParamError; message: string } {
  const { lat, lng, city, limit } = parsed.filters;

  if (lat !== undefined && (lat < -90 || lat > 90)) {
    return { ok: false, error: "lat", message: SEARCH_PARAM_ERROR_MESSAGES.lat };
  }
  if (lng !== undefined && (lng < -180 || lng > 180)) {
    return { ok: false, error: "lng", message: SEARCH_PARAM_ERROR_MESSAGES.lng };
  }

  // limit: a present-but-unparseable or non-positive-integer value is a 400;
  // absent and blank stay valid (treated as "use the default").
  if (
    (parsed.rawLimit !== null && parsed.rawLimit.trim() !== "" && limit === undefined) ||
    (limit !== undefined && (!Number.isInteger(limit) || limit <= 0))
  ) {
    return { ok: false, error: "limit", message: SEARCH_PARAM_ERROR_MESSAGES.limit };
  }

  // DG128: explicit city must be known; never silently re-anchor.
  if (city !== undefined && !findCity(city)) {
    return { ok: false, error: "city", message: SEARCH_PARAM_ERROR_MESSAGES.city };
  }

  return { ok: true };
}

// The serializer half of the contract lives in `search-url.ts` (neutral —
// no server-only) so the map panel's client code shares it too. Re-exported
// here so server callers keep one import site.
export { serializeSearchParams } from "./search-url";

/**
 * True when any nomad filter param is set — the SSR `/search` page uses it
 * (with `q`) to decide whether `executeSearch` has anything to do; a bare
 * `/search` hit skips the query entirely.
 */
export function hasActiveFilterParams(filters: SearchFilters): boolean {
  return (
    filters.open_now === true ||
    filters.filter_max_stay !== undefined ||
    WORK_DIM_FILTER_MAP.some(({ key }) => filters[key] !== undefined)
  );
}
