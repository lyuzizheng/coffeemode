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
 * BRAWUKA-322 §1.1): consumers MUST feature-detect (`provider.getBounds?.()`)
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

  /** Smoothly transitions the map view to a new center and optional zoom.
   * `durationMs` bounds the camera beat — the locate recenter uses the
   * `settle.slow` budget (≤450ms, DG119); omit for the renderer default. */
  flyTo(center: Coordinates, zoom?: number, durationMs?: number): void;

  /** Camera padding in px — keeps pins clear of the sheet/detail chrome. */
  setPadding(padding: { top: number; right: number; bottom: number; left: number }): void;

  /** Replaces the cafe dataset (pins + clusters). */
  setCafes(cafes: CafeSummary[]): void;

  /** Marks one cafe selected (halo) or clears it (null). */
  setSelectedCafe(cafeId: string | null): void;

  /** Registers the cafe-tap callback; returns an unsubscribe function. */
  onCafeSelect(handler: (cafeId: string) => void): () => void;

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

  /**
   * Renders the granted user position as the brand location dot (accent
   * disc + paper ring + accuracy halo, DG120) on its own source/layers —
   * above cafe pins, never folded into the cafe dataset. `null` clears it.
   * Optional: consumers feature-detect.
   */
  setUserLocation?(location: UserLocation | null): void;

  /**
   * Registers a callback for the FIRST user-initiated camera gesture
   * (drag/scroll/pinch — programmatic flyTo/setCenter never fire it).
   * Onboarding uses it to honor "no recenter after user pan" (DG119).
   * Returns an unsubscribe function. Optional: consumers feature-detect.
   */
  onCameraGesture?(handler: () => void): () => void;

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
  /** UI theme — each provider maps it to its own style (the MapLibre
   * provider resolves a style document URL from `map.maplibre.tileStyle`). */
  theme?: string;
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

/** The rendered user position (DG120): coordinates plus the fix's accuracy
 * radius in meters — drives the optional halo ring. */
export interface UserLocation extends Coordinates {
  accuracyM?: number;
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
