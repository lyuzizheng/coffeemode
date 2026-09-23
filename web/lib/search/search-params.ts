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
 * (absent) rather than throwing, and a repeated parameter resolves to its
 * first value (`URLSearchParams.get` semantics) so the SSR array form can
 * never diverge from the API (BRAWUKA-670). Rejection policy lives in
 * `validateSearchQuery` below — the API maps it to 400s and the SSR page
 * maps it to an error state, so the two surfaces can never drift on what
 * counts as an invalid deep link.
 */
export interface ParsedSearchQuery {
  /** Parsed filters; `city`/`lat`/`lng`/`limit` are the raw (unvalidated) values. */
  filters: SearchFilters;
  /** Raw coordinate strings so validation can distinguish absent / blank / invalid. */
  rawLat: string | null;
  rawLng: string | null;
  /** Raw `limit` string so the API can distinguish absent / blank / invalid. */
  rawLimit: string | null;
}

export function parseSearchQuery(
  get: (name: string) => string | string[] | null | undefined,
): ParsedSearchQuery {
  // Repeated params resolve to their first value on every surface — the
  // API's `URLSearchParams.get` semantics — so an SSR `searchParams` array
  // can never diverge from the API's first-value read (BRAWUKA-670).
  const first = (name: string): string | null => {
    const value = get(name);
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };
  const q = first("q")?.trim() || undefined;
  const city = first("city")?.trim() || undefined;
  const rawLat = first("lat");
  const lat = parseQueryNumber(rawLat);
  const rawLng = first("lng");
  const lng = parseQueryNumber(rawLng);
  const openNow = parseQueryBoolean(first("open_now"));
  const includeLive = parseQueryBoolean(first("include_live"));
  const filterMaxStay = parseMaxStayFilter(first("filter_max_stay"));
  const rawLimit = first("limit");
  const limit = parseQueryNumber(rawLimit);
  const rawRanking = first("ranking")?.trim();
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
    const val = parseQueryScore(first(key));
    if (val !== undefined) {
      filters[key] = val;
    }
  }

  return { filters, rawLat, rawLng, rawLimit };
}

const SEARCH_PARAM_ERROR_MESSAGES: Record<SearchParamError, string> = {
  lat: "lat must be a number within [-90, 90]",
  lng: "lng must be a number within [-180, 180]",
  lat_lng: "lat and lng must be provided together",
  limit: "limit must be a positive integer",
  city: "unknown city",
};

/**
 * The rejection half of the deep-link contract, shared by `GET /api/search`
 * (400 `invalid_request`) and the SSR `/search` page (error state). Check
 * order matches the API: lat, lng, lat/lng pairing, limit, then known
 * city — callers must not reorder or subset it.
 */
export function validateSearchQuery(
  parsed: ParsedSearchQuery,
):
  | { ok: true; filters: SearchFilters }
  | {
      ok: false;
      error: SearchParamError;
      status: 400;
      code: "invalid_request";
      message: string;
    } {
  const { lat, lng, city, limit } = parsed.filters;
  // Raw presence follows the `limit` convention: a blank value counts as
  // absent, a non-blank one as present — parseable or not (BRAWUKA-670).
  const present = (raw: string | null) => raw !== null && raw.trim() !== "";
  const latPresent = present(parsed.rawLat);
  const lngPresent = present(parsed.rawLng);
  const reject = (error: SearchParamError) => ({
    ok: false as const,
    error,
    status: 400 as const,
    code: "invalid_request" as const,
    message: SEARCH_PARAM_ERROR_MESSAGES[error],
  });

  // BRAWUKA-670: a present-but-unparseable coordinate is a 400, same as
  // `limit` — malformed input is never silently dropped and re-anchored.
  if ((latPresent && lat === undefined) || (lat !== undefined && (lat < -90 || lat > 90))) {
    return reject("lat");
  }
  if ((lngPresent && lng === undefined) || (lng !== undefined && (lng < -180 || lng > 180))) {
    return reject("lng");
  }

  // BRAWUKA-597: a lone coordinate is a meaningless anchor — lat/lng must
  // arrive as a pair or not at all. Pairing is checked on raw presence so a
  // malformed half still counts as "present" (BRAWUKA-670); it runs after
  // the malformed/range checks so a bad value reports its own error first.
  if (latPresent !== lngPresent) {
    return reject("lat_lng");
  }
  // limit: a present-but-unparseable or non-positive-integer value is a 400;
  // absent and blank stay valid (treated as "use the default").
  if (
    (present(parsed.rawLimit) && limit === undefined) ||
    (limit !== undefined && (!Number.isInteger(limit) || limit <= 0))
  ) {
    return reject("limit");
  }

  // DG128: explicit city must be known; never silently re-anchor.
  if (city !== undefined && !findCity(city)) {
    return reject("city");
  }

  return { ok: true, filters: parsed.filters };
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
