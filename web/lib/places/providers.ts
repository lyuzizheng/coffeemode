import type { ExternalSourceFlags } from "@/lib/client-env";
import type { CreateTranslator, PlaceSearchProvider } from "./place-search";
import { googlePlaceSearch } from "./google-place-search";
import { applePlaceSearch } from "./apple-place-search";

export interface PlaceSearchProviderFlags {
  /** `search.externalSources` toggles (DG134) — read via `getSearchExternalSources()`. */
  externalSources: ExternalSourceFlags;
  /** DG143 MapKit readiness — a request-time signal drilled from the server
      page (`APPLE_MAPKIT_*` are runtime env, never build-time). */
  mapkitConfigured: boolean;
}

/**
 * The place-search provider registry (owner directive 2026-09-16: geocoding
 * is a replaceable layer). Order is the UI toggle order; adding or swapping
 * a provider is a one-line change here — the creation sheet never names a
 * vendor.
 *
 * DG134/DG143 gating mirrors the search CTA rule in `search-results-list`:
 * a source switched off in `app.yaml` is never offered, and Apple
 * additionally requires MapKit readiness — otherwise its tab would render
 * and only fail at `init()` with the token route's 503.
 */
export function getPlaceSearchProviders(
  t: CreateTranslator,
  flags: PlaceSearchProviderFlags,
): PlaceSearchProvider[] {
  const providers: PlaceSearchProvider[] = [];
  if (flags.externalSources.google) providers.push(googlePlaceSearch(t));
  if (flags.externalSources.apple && flags.mapkitConfigured) {
    providers.push(applePlaceSearch(t));
  }
  return providers;
}
