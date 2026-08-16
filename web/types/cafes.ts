import type { WeeklyHours } from "@/lib/hours";
import type { WorkStats } from "@/lib/stats/work-stats";
import type { StoredImage } from "./images";

/** Cafe as returned by list/nearby queries (map + cards). */
export interface CafeSummary {
  id: string;
  slug: string | null;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  /** IANA timezone name; null means open-now must render "unknown" (#77). */
  tz: string | null;
  opening_hours: WeeklyHours | null;
  price_range: number | null;
  work_stats: WorkStats;
  /** Meters from the query point; present on nearby queries. */
  distance_m?: number;
}

/** Full cafe row for the detail surface. */
export interface CafeDetail extends Omit<CafeSummary, "distance_m"> {
  description: string | null;
  cover: string | null;
  gallery: StoredImage[];
  google_place_id: string | null;
  apple_poi_id: string | null;
  // created_by is intentionally not exposed: the creator stays anonymous (spec 0001).
  created_at: string;
  updated_at: string;
}
