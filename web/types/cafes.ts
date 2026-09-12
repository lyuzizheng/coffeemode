import type { WeeklyHours } from "@/lib/hours";
import type { WorkStats } from "@/lib/stats/work-stats";
import type { PublicAuthor } from "./identity";
import type { PublicStoredImage, StoredImage } from "./images";

export type CafeVisibility = "public" | "private";

/** Cafe as returned by list/nearby queries (map + cards). */
export interface CafeSummary {
  id: string;
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
  /** Card-variant R2 key for list/card covers; null when the cafe has no photo yet. */
  cover: string | null;
  /** Meters from the query point; present on nearby queries. */
  distance_m?: number;
  /**
   * True when the cafe is attributed to the CoffeeMode service account (no
   * human owner). A marker, not copy — the client renders the localized
   * maintainer line from `discovery.maintained_by_service` (spec 0002 i18n).
   */
  maintained_by_service: boolean;
  visibility?: CafeVisibility;
}

/** Full cafe row for the detail surface. */
export interface CafeDetail extends Omit<CafeSummary, "distance_m"> {
  description: string | null;
  gallery: StoredImage[];
  google_place_id: string | null;
  apple_poi_id: string | null;
  /** Internal creator id; stripped on public projections (spec 0001 DG13). */
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

/** Public cafe detail (spec 0001 DG13): creator id and gallery `by` are stripped for anonymous surface. */
export type PublicCafeDetail = Omit<CafeDetail, "gallery" | "created_by"> & {
  gallery: PublicStoredImage[];
  visibility?: CafeVisibility;
  /**
   * Consented public author of the cafe creator (spec 0006). Null means the
   * client renders the existing anonymous copy; always null for null /
   * service-account `created_by`.
   */
  author: PublicAuthor | null;
};
