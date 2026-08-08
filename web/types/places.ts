/**
 * POI types shared between the web app and the POI cache service.
 * Shape mirrors poi-service/src/types.ts (the worker is the source of truth).
 */

export type POISource = "google" | "apple";

export interface POI {
  place_id: string;
  source: POISource;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  types: string[];
  business_status: string | null;
  hours_json: string | null;
  photo_refs: string[];
  fetched_at: string;
}

export interface POISearchHit extends POI {
  distance_km?: number;
}

export interface POISearchResponse {
  results: POISearchHit[];
}
