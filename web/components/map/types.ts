import type { Coordinates } from "@/lib/cities";
import type { CafeSummary } from "@/types/cafes";

/**
 * Map provider contract (map-home, BRAWUKA-311; hardened 2026-09-16 per the
 * owner directive: the map is a replaceable layer — a Google/Apple swap is a
 * new implementation of this interface, never a surface rewrite).
 *
 * Everything the surface needs lives here: camera, viewport padding, cafe
 * data, selection, and the tap callback. No renderer types (MapLibre, MapKit,
 * Google) cross this boundary — `discovery-map.tsx` and `use-map-bindings.ts`
 * are renderer-agnostic by construction.
 *
 * Members marked optional are capability extensions (BRAWUKA-330, design
 * BRAWUKA-322 §1.1): consumers MUST feature-detect (`provider.onMapTap?.(…)`)
 * — a provider that cannot offer the capability simply omits it.
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

  /** Camera padding in px — keeps pins clear of the sheet/detail chrome. */
  setPadding(padding: { top: number; right: number; bottom: number; left: number }): void;

  /** Replaces the cafe dataset (pins + clusters). */
  setCafes(cafes: CafeSummary[]): void;

  /** Marks one cafe selected (halo) or clears it (null). */
  setSelectedCafe(cafeId: string | null): void;

  /** Registers the cafe-tap callback; returns an unsubscribe function. */
  onCafeSelect(handler: (cafeId: string) => void): () => void;

  /**
   * Registers a map-tap callback for taps that hit no pin or cluster —
   * the map-creation-entry trigger (tap / long-press → create). Returns an
   * unsubscribe function. Optional: consumers feature-detect.
   */
  onMapTap?(handler: (coordinates: Coordinates) => void): () => void;

  /** Current viewport bounds. Optional: consumers feature-detect. */
  getBounds?(): MapBounds;

  /**
   * Registers a viewport-settled callback — fires after camera motion ends
   * (pan/zoom/flyTo), the "search this area" trigger. Returns an unsubscribe
   * function. Optional: consumers feature-detect.
   */
  onIdle?(handler: () => void): () => void;

  /**
   * Replaces the external-POI pin set (map-discovery-integration live search
   * results). A channel separate from `setCafes` — external POIs are not
   * cafes and must not be forced into `CafeSummary`. Optional: consumers
   * feature-detect.
   */
  setExternalPins?(pins: ExternalPin[]): void;

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
  /** Opaque style handle — each provider defines what it accepts (the
   * MapLibre provider takes a style document URL). */
  style: unknown;
  /** Accessible name for the map container (localized by the caller). */
  ariaLabel?: string;
  /** Called once the map's first style load completes. */
  onLoad: (provider: IMapProvider) => void;
  /** Called when the basemap fails irrecoverably (style/source/WebGL). */
  onError: (error: unknown) => void;
}

/** Viewport bounds — the `getBounds` return shape. */
export interface MapBounds {
  ne: Coordinates;
  sw: Coordinates;
}

/**
 * An external POI rendered as a map pin (map-discovery-integration live
 * search results) — deliberately minimal: id/coordinates/label/source. Not a
 * `CafeSummary`; the pin channel is display-only and carries no cafe data.
 */
export interface ExternalPin {
  /** Stable id within the result set (used for feature identity). */
  id: string;
  coordinates: Coordinates;
  /** POI display name; rendered under the pin when present. */
  label?: string;
  /** Upstream source tag (e.g. "google", "apple") — provenance only. */
  source: string;
}
