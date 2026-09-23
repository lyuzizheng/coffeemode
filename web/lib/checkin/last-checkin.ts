import { apiFetch } from "@/lib/http";
import type { CheckInScores, MaxStay } from "@/types/checkins";
import type { PublicStoredImage } from "@/types/images";

/** The caller's most recent check-in for a cafe, as returned by /api/checkins/last. */
export interface LastCheckin {
  id: string;
  scores: CheckInScores;
  max_stay: MaxStay | null;
  note: string | null;
  /** Attached photos — the preempted edit seeds them into the picker
   *  (BRAWUKA-563). */
  photos: PublicStoredImage[];
  visited_at: string;
}

/**
 * Shared probe for the caller's last check-in at a cafe — the DG64 revisit
 * switch in the drawer keys off it (one query key, one network call).
 * A 401 surfaces as `ApiError` carrying the UNAUTHORIZED marker: anonymous
 * on a CDN-cached shell is an expected answer, never a retried failure.
 */
export async function fetchLastCheckin(cafeId: string) {
  return apiFetch<{
    checkin: LastCheckin | null;
    revisit_window_hours?: number;
  }>(`/api/checkins/last?cafe_id=${encodeURIComponent(cafeId)}`);
}
