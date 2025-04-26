/**
 * A literal representation of latitude/longitude coordinates.
 */
export interface LatLngLiteral {
  lat: number;
  lng: number;
}

/**
 * Defines a unified interface for interacting with different map providers.
 */
export interface IMapProvider {
  /** Sets the map's center. */
  setCenter(center: LatLngLiteral): void;

  /** Sets the map's zoom level. */
  setZoom(zoom: number): void;

  /** Gets the map's current center. */
  getCenter(): LatLngLiteral;

  /** Gets the map's current zoom level. */
  getZoom(): number;

  /** Smoothly transitions the map view to a new center and optional zoom. */
  flyTo(center: LatLngLiteral, zoom?: number): void;

  /** Cleans up map resources. */
  destroy(): void;
}

/**
 * Defines the props expected by map provider components.
 */
export interface BaseMapProviderProps {
  className?: string;
  center: LatLngLiteral;
  zoom: number;
  onLoad: (provider: IMapProvider) => void;
  /** Optional callback for when the map view changes (e.g., after pan or zoom). */
  onViewChange?: (newCenter: LatLngLiteral, newZoom: number) => void;
}
