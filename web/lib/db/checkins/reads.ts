import "server-only";

import { isValidUUID } from "@shared/uuid";
import {
  type CheckInScores,
  type MaxStay,
} from "@/types/checkins";
import type { PublicStoredImage } from "@/types/images";
import { query } from "../postgres";

export async function getLastCheckinForCafe(
  userId: string,
  cafeId: string,
  q = query,
): Promise<{ id: string; scores: CheckInScores; max_stay: MaxStay | null; note: string | null; photos: PublicStoredImage[]; visited_at: string } | null> {
  if (!isValidUUID(userId) || !isValidUUID(cafeId)) return null;
  const result = await q<{
    id: string;
    scores: CheckInScores;
    max_stay: MaxStay | null;
    note: string | null;
    photos: PublicStoredImage[] | null;
    visited_at: string;
  }>(
    // photos ride along so the DG64 preempt can seed the edit picker's
    // existing-photo tiles (BRAWUKA-563); `by` is stripped — the public
    // projection never carries author ids (DG13).
    `select id, scores, max_stay, note, visited_at,
       coalesce((select jsonb_agg(p - 'by') from jsonb_array_elements(photos) p), '[]'::jsonb) as photos
     from checkins
     where user_id = $1 and cafe_id = $2 and deleted_at is null
     order by visited_at desc limit 1`,
    [userId, cafeId],
  );
  const row = result.rows[0];
  return row ? { ...row, photos: Array.isArray(row.photos) ? row.photos : [] } : null;
}
