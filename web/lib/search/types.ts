import type { CafeSummary } from "@/types/cafes";
import type { MaxStay } from "@/types/checkins";
import type { POI } from "@shared/places/types";

export type SearchResultType = "cafe" | "poi";
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
}

export interface SearchResultItem {
  id: string;
  type: SearchResultType;
  source: SearchResultSource;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  distance_m: number | null;
  is_from_city_center: boolean;
  cafe?: CafeSummary;
  poi?: POI;
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
  search_mode?: "stored_only" | "live";
}
