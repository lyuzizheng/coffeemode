import "server-only";

import { isValidUUID } from "@shared/uuid";
import {
  type CheckInScores,
  type MaxStay,
} from "@/types/checkins";
import type { StoredImage } from "@/types/images";
import { query } from "../postgres";

const OWNS_CHECKIN_SQL = `
select cafe_id from checkins where id = $1 and user_id = $2 and deleted_at is null
`;

export async function ownsCheckin(
  checkinId: string,
  userId: string,
  q = query,
): Promise<boolean> {
  if (!isValidUUID(checkinId) || !isValidUUID(userId)) return false;
  const result = await q<{ cafe_id: string | null }>(OWNS_CHECKIN_SQL, [checkinId, userId]);
  return result.rows.length > 0;
}

const ATTACH_IMAGE_TO_CHECKIN_SQL = `
update checkins
set photos = coalesce(photos, '[]'::jsonb) || (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements($1::jsonb) elem
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(photos, '[]'::jsonb)) g
    where g->>'id' = elem->>'id'
  )
)
where id = $2 and user_id = $3 and deleted_at is null
returning id, cafe_id
`;

export async function attachImageToCheckin(
  params: {
    checkinId: string;
    userId: string;
    image: StoredImage;
  },
  q = query,
): Promise<{ ok: boolean; cafeId: string | null }> {
  const result = await q<{ id: string; cafe_id: string | null }>(
    ATTACH_IMAGE_TO_CHECKIN_SQL,
    [JSON.stringify([params.image]), params.checkinId, params.userId],
  );
  if (result.rows.length === 0) return { ok: false, cafeId: null };
  return { ok: true, cafeId: result.rows[0].cafe_id };
}

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
