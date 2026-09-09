import type { CheckInScores, MaxStay } from "@/types/checkins";

/** The caller's most recent check-in for a cafe, as returned by /api/checkins/last. */
export interface LastCheckin {
  id: string;
  scores: CheckInScores;
  max_stay: MaxStay | null;
  note: string | null;
  visited_at: string;
}

/**
 * Shared probe for the caller's last check-in at a cafe — the DG64 revisit
 * switch in the drawer and the DG72 "Edit your check-in" row on the cafe
 * page both key off it (one query key, one network call). 401 throws
 * Error("unauthorized"): anonymous on a CDN-cached shell is an expected
 * answer, never a retried failure.
 */
export async function fetchLastCheckin(cafeId: string) {
  const res = await fetch(`/api/checkins/last?cafe_id=${encodeURIComponent(cafeId)}`);
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error("failed");
  const body = (await res.json()) as {
    checkin: LastCheckin | null;
    revisitWindowHours?: number;
  };
  return body;
}
