/**
 * POI types — the single source of truth shared by the web app and the
 * POI cache service. The worker's D1 store persists exactly this shape.
 */

export type POISource = "google" | "apple";

/** Normalized POI record — the D1 durable store shape. */
export interface POI {
  place_id: string;
  source: POISource;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  types: string[];
  business_status: string | null;
  /** Raw JSON of Google regularOpeningHours (or null). */
  hours_json: string | null;
  /** Photo references (Google photo.name values / Apple refs). */
  photo_refs: string[];
  /** ISO 8601 timestamp of when this record was fetched. */
  fetched_at: string;
}

export interface POISearchHit extends POI {
  distance_km?: number;
}

/** Web /api/places/search response shape. */
export interface POISearchResponse {
  results: POISearchHit[];
}
