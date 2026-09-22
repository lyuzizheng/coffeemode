import type { CafeSummary } from "@/types/cafes";
import type { MaxStay } from "@/types/checkins";
import type { POI, PlacePrediction } from "@shared/places/types";

type SearchResultType = "cafe" | "poi";
export type SearchResultSource = "coffeemode" | "stored_poi" | "google" | "apple";

export interface SearchFilters {
  q?: string;
  city?: string;
  lat?: number;
  lng?: number;
  open_now?: boolean;
  filter_wifi?: number;
  filter_outlets?: number;
  filter_seats?: number;
  filter_temp?: number;
  filter_coffee?: number;
  filter_overall?: number;
  filter_max_stay?: MaxStay;
  limit?: number;
  include_live?: boolean;
  ranking?: string;
  viewer_id?: string | null;
}

/**
 * Which parsed deep-link parameter failed `validateSearchQuery`
 * (`search-params.ts`), in the API's check order. The SSR page maps these
 * to error-state copy; the API maps them to 400 `invalid_request`.
 */
export type SearchParamError = "lat" | "lng" | "limit" | "city";

export interface SearchResultItem {
  id: string;
  type: SearchResultType;
  source: SearchResultSource;
  name: string;
  address: string | null;
  /** Null for a live Autocomplete prediction: it carries no coordinates until
   *  the user selects it and the Place Details call resolves it (BRAWUKA-602). */
  lat: number | null;
  lng: number | null;
  /** Google's `distanceMeters` for a prediction (measured from the reference
   *  point), or the haversine distance for a stored POI / cafe. */
  distance_m: number | null;
  is_from_city_center: boolean;
  cafe?: CafeSummary;
  poi?: POI;
  /** Set on live results: the typing-phase hit, resolved on selection. */
  prediction?: PlacePrediction;
  /** Autocomplete session that produced `prediction`. The selection's Place
   *  Details call must carry it, or the typing phase is billed per request
   *  (BRAWUKA-602). */
  prediction_session?: string;
}

export interface SearchReferencePoint {
  lat: number | null;
  lng: number | null;
  is_from_city_center: boolean;
  city_id?: string;
  city_name?: string;
}
export interface SearchResponse {
  results: SearchResultItem[];
  total_count: number;
  is_weak_results: boolean;
  reference_point: SearchReferencePoint;
  warnings?: string[];
}

export interface SearchServiceResponse extends SearchResponse {
  search_mode?: "stored_only" | "live";
}
