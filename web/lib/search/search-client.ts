import { findCity } from "@/lib/cities";
import { apiFetch } from "@/lib/http";
import { readOnboardingState } from "@/lib/onboarding-store";
import { getRankingPreference, type RankingPreference } from "./ranking-preference";
import { filtersToSearchParams, type SearchFilterState } from "./search-filters";
import type { SearchResponse } from "./types";

/** Device-storage resolution snapshot for one request attempt — scope and
 * ranking read ONCE, then shared by the panel's request identity and the
 * transport's wire params so a storage change mid-attempt can never make
 * them disagree (BRAWUKA-793). `ranking` preserves the `null` state:
 * "never chose" must emit nothing, not a re-read. */
export interface SearchRequestResolution {
  scope: { city?: string; lat?: number; lng?: number };
  ranking: RankingPreference | null;
}

export interface UnifiedSearchParams {
  q: string;
  city?: string;
  lat?: number;
  lng?: number;
  limit?: number;
  /** Nomad filters (DG44–DG58): open_now + filter_* thresholds + max_stay. */
  filters?: SearchFilterState;
  /**
   * Pre-resolved scope/ranking snapshot for this attempt (BRAWUKA-793). The
   * search panel resolves once and passes its snapshot through this seam so
   * the emitted wire values are provably the ones the request signed with;
   * absent → the transport resolves from storage itself (unchanged behavior
   * for every other caller).
   */
  resolved?: SearchRequestResolution;
  signal?: AbortSignal;
}

/**
 * Translate the caller's city scope into `?city=`/`?lat&lng` params that stay
 * inside the `/api/search` contract (BRAWUKA-568): `?city=` only accepts
 * launch-city ids — a runtime city id (DG121, named from granted
 * coordinates, never a client header — BRAWUKA-640) would 400 every search.
 * Launch cities send their canonical id; runtime/unknown cities drop `city`
 * and scope by coordinates instead — caller-provided lat/lng first, then the
 * stored `lastLocation` fix that the locate flow persists alongside the
 * runtime id. With neither, both params are omitted and the server resolves
 * scope from request headers (DG128).
 */
export function resolveSearchScope(
  city?: string,
  lat?: number,
  lng?: number,
): { city?: string; lat?: number; lng?: number } {
  if (city) {
    const known = findCity(city);
    if (known) return { city: known.id, lat, lng };
  } else {
    return { lat, lng };
  }
  // Unknown/runtime city: prefer a complete caller coordinate pair, then the
  // stored fix — never mix halves from different sources.
  if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
  const stored = readOnboardingState()?.lastLocation;
  if (stored) return { lat: stored.lat, lng: stored.lng };
  return {};
}

/**
 * Resolve this attempt's scope + ranking from device storage exactly once
 * (BRAWUKA-793). The panel calls this per fired request and hands the same
 * snapshot to its identity signature and the fetch seam — a storage write
 * between those consumers cannot split them. The transport resolves its own
 * snapshot only when the caller passed none.
 */
export function resolveSearchRequest(
  city?: string,
  lat?: number,
  lng?: number,
): SearchRequestResolution {
  return {
    scope: resolveSearchScope(city, lat, lng),
    ranking: getRankingPreference(),
  };
}

/**
 * Canonical `/api/search` parameter serialization — the one shape both
 * consumers produce (BRAWUKA-736): `fetchUnifiedSearch` emits it on the
 * wire, and the search panel serializes its request identity from it. The
 * caller supplies the attempt's `resolved` snapshot (`resolveSearchRequest`)
 * so identity and transport provably share resolved scope/preference
 * values; `signal` never appears — cancellation is transport, not identity.
 * Reuses the neutral filter writer (`filtersToSearchParams`) so the
 * emission order `q → city/lat/lng → limit → filter_* → ranking` is
 * identical on both sides.
 */
export function buildUnifiedSearchParams({
  q,
  limit,
  filters,
  resolved,
}: {
  q: string;
  limit?: number;
  filters?: SearchFilterState;
  resolved: SearchRequestResolution;
}): URLSearchParams {
  const params = new URLSearchParams({ q });
  if (resolved.scope.city) params.set("city", resolved.scope.city);
  if (typeof resolved.scope.lat === "number") params.set("lat", String(resolved.scope.lat));
  if (typeof resolved.scope.lng === "number") params.set("lng", String(resolved.scope.lng));
  if (typeof limit === "number") params.set("limit", String(limit));
  if (filters) filtersToSearchParams(filters, params);
  if (resolved.ranking) params.set("ranking", resolved.ranking);
  return params;
}

/**
 * Client for `GET /api/search` (map-independent unified search, DG44–DG58).
 * Pure transport: results stay in server order — grouping is a render-layer
 * concern (`grouped-results.ts`, DG131) and this client never re-sorts.
 *
 * DG136: when the user has chosen a ranking preference it is appended as
 * `?ranking=good_first|relevance`; when unset (anonymous, never touched the
 * toggle) the parameter is omitted and the server default applies.
 *
 * BRAWUKA-793: a caller-supplied `resolved` snapshot is used verbatim —
 * never re-read from storage — so the panel's identity and this wire share
 * one attempt's values. Callers that omit `resolved` get the transport's
 * own single read (`resolveSearchRequest`); either way the wire resolves
 * storage at most once per call.
 */
export async function fetchUnifiedSearch(
  params: UnifiedSearchParams,
): Promise<SearchResponse> {
  const { signal, resolved, city, lat, lng, q, limit, filters } = params;
  const request = resolved ?? resolveSearchRequest(city, lat, lng);
  return apiFetch<SearchResponse>(
    `/api/search?${buildUnifiedSearchParams({ q, limit, filters, resolved: request }).toString()}`,
    { method: "GET", signal },
  );
}

// `buildSearchHref` lives in `search-url.ts` — the neutral module that owns
// the canonical `?q&city&filter_*` serialization for both server and client.
