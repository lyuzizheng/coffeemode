/**
 * POI types — the single source of truth shared by the web app and the
 * POI cache service. The worker's D1 store persists exactly this shape.
 */

export type POISource = "google" | "apple";

/** Normalized POI record — the D1 bounded cache shape. */
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
  /** ISO 8601 timestamp of when this record was fetched. */
  fetched_at: string;
  /** ISO 8601 timestamp of when this cached record expires (fetched_at + 30d). */
  expires_at?: string;
  /** Observability field for live external POIs that were not persisted (DG144). */
  not_persisted_reason?: "non_food_category";
}

export interface POISearchHit extends POI {
  distance_km?: number;
}

/** Web /api/places/search response shape. */
export interface POISearchResponse {
  results: POISearchHit[];
}
