/**
 * Flat query-key conventions for TanStack Query.
 *
 * These keys are used for cache invalidation and (selectively) for
 * IndexedDB persistence. Keep them flat and predictable: a mutation
 * should explicitly invalidate every key it affects rather than relying
 * on prefix matching.
 */

export const queryKeys = {
  profile: ["profile"] as const,

  cafesList: (params: { lat: number; lng: number; radius: number; filters?: string }) =>
    ["cafes-list", params.lat, params.lng, params.radius, params.filters ?? "all"] as const,

  cafe: (id: string) => ["cafe", id] as const,

  cafeCheckins: (id: string) => ["cafe-checkins", id] as const,

  pendingNavigations: ["navigations-pending"] as const,

  poiSearch: (params: { q: string; lat: number; lng: number; radius: number }) =>
    ["pois-search", params.q, params.lat, params.lng, params.radius] as const,

  poi: (placeId: string) => ["poi", placeId] as const,
};

/**
 * Keys whose data should survive a tab close/reopen in IndexedDB.
 * Keep this list small to avoid bloating the client store.
 */
export const PERSISTED_QUERY_KEYS = [
  "profile",
  "cafe",
  "cafes-list",
] as const satisfies readonly string[];
