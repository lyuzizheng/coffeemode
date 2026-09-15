import "server-only";

import { isValidUUID } from "@shared/uuid";
import {
  type CheckInScores,
  type MaxStay,
} from "@/types/checkins";
import { query } from "../postgres";

export async function getLastCheckinForCafe(
  userId: string,
  cafeId: string,
  q = query,
): Promise<{ id: string; scores: CheckInScores; max_stay: MaxStay | null; note: string | null; visited_at: string } | null> {
  if (!isValidUUID(userId) || !isValidUUID(cafeId)) return null;
  const result = await q<{
    id: string;
    scores: CheckInScores;
    max_stay: MaxStay | null;
    note: string | null;
    visited_at: string;
  }>(
    `select id, scores, max_stay, note, visited_at from checkins
     where user_id = $1 and cafe_id = $2 and deleted_at is null
     order by visited_at desc limit 1`,
    [userId, cafeId],
  );
  return result.rows[0] ?? null;
}
