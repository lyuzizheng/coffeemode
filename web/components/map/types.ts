import type { Map as MapLibreMap } from "maplibre-gl";
import type { Coordinates } from "@/lib/cities";

/**
 * Map provider contract (map-home, BRAWUKA-311). Ported from the archived
 * `_archive-coffeemode-frontend` map slice with `LatLngLiteral` replaced by
 * the shared `Coordinates` (same shape) — there is exactly one provider
 * (OpenFreeMap/MapLibre); the interface stays because the surface binds to
 * it, not to MapLibre's API surface.
 */
export interface IMapProvider {
  /** Sets the map's center. */
  setCenter(center: Coordinates): void;

  /** Sets the map's zoom level. */
  setZoom(zoom: number): void;

  /** Gets the map's current center. */
  getCenter(): Coordinates;

  /** Gets the map's current zoom level. */
  getZoom(): number;

  /** Smoothly transitions the map view to a new center and optional zoom. */
  flyTo(center: Coordinates, zoom?: number): void;

  /** Cleans up map resources. */
  destroy(): void;
}

/**
 * Props for the basemap provider component. `initialCenter`/`initialZoom`
 * are mount-time values only — post-mount camera moves go through the
 * `IMapProvider` handed to `onLoad` (the archived version silently ignored
 * later prop changes; mount-once + imperative flyTo is the fix).
 */
export interface BaseMapProviderProps {
  className?: string;
  initialCenter: Coordinates;
  initialZoom: number;
  /** Style JSON object or style URL; switching it re-styles in place. */
  style: unknown;
  /** Accessible name for the map container (localized by the caller). */
  ariaLabel?: string;
  /** Called once the map's first style load completes. */
  onLoad: (provider: IMapProvider, map: MapLibreMap) => void;
  /** Called when the basemap fails irrecoverably (style/source/WebGL). */
  onError: (error: unknown) => void;
}
