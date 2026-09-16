import type { Deps, Env, POISource } from "../types";
import { GooglePlacesProvider, isGooglePlaceId } from "./google";
import type { UpstreamPlacesProvider } from "./types";

export * from "./types";
export * from "./apple";
export * from "./google";

/**
 * Resolve the upstream provider for a given source.
 * Apple has no server-side Places API, returning null.
 */
export function getUpstreamProvider(
  source: POISource,
  env: Env,
  deps?: Deps,
): UpstreamPlacesProvider | null {
  switch (source) {
    case "google":
      return new GooglePlacesProvider(env, deps?.fetchImpl);
    case "apple":
      return null;
    default:
      return null;
  }
}

/**
 * Resolves the upstream source for a place_id.
 * If the place already has a stored source in D1, that source is authoritative (issue #38).
 * For never-seen ids, falls back to the prefix heuristic (isGooglePlaceId).
 */
export function resolveUpstreamSource(
  placeId: string,
  storedSource?: POISource | null,
): POISource | null {
  if (storedSource) return storedSource;
  if (isGooglePlaceId(placeId)) return "google";
  return null;
}
