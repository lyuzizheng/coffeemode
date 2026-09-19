import "server-only";

import { parseQueryBoolean, parseQueryNumber, parseQueryScore } from "@/lib/api/response";
import { parseMaxStayFilter } from "@/lib/validation/checkin";
import { WORK_DIM_FILTER_MAP } from "./filter";
import type { SearchFilters } from "./types";

/**
 * Shared `?q&city&filter_*` parsing for `GET /api/search` and the SSR
 * `/search` page — the deep-link contract (DG48, spec 0001 §Search) lives in
 * exactly one place so the two surfaces can never drift on parameter names
 * or value semantics.
 *
 * Parsing is permissive by design: malformed values drop to `undefined`
 * (absent) rather than throwing. Callers own their own rejection policy —
 * the API 400s on out-of-range lat/lng/limit and unknown cities; the page
 * renders an error state instead.
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
