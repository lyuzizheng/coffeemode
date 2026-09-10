import "server-only";

import { isValidUUID } from "@shared/uuid";
import { recomputeWorkStats } from "@/lib/stats/aggregate";
import {
  CheckInForbiddenError,
  CheckInNotFoundError,
  type UpdateCheckInInput,
} from "@/lib/validation/checkin";
import { txRunnerFrom, withTransaction } from "../postgres";

/* ------------------------------------------------------------------ *
 * Edit + soft delete — both recompute work_stats from scratch (spec 0001
 * §Aggregation: edit→recompute, soft-delete→recompute). Incremental fold is
 * not used here: it assumes the changed check-in is the latest for that
 * user, but visited_at can be backdated.
 * ------------------------------------------------------------------ */

const SELECT_CHECKIN_FOR_UPDATE_SQL = `
 select id, cafe_id, user_id, is_creation, scores, max_stay, note, photos, visited_at, deleted_at
 from checkins where id = $1 for update
`;

export async function updateCheckIn(
  userId: string,
  checkinId: string,
  patch: UpdateCheckInInput,
): Promise<{ cafeId: string }> {
  if (!isValidUUID(userId) || !isValidUUID(checkinId)) throw new Error("Invalid user or check-in ID");

  return withTransaction(async (client) => {
    const existing = await client.query<{
      id: string;
      cafe_id: string;
      user_id: string;
      deleted_at: string | null;
    }>(SELECT_CHECKIN_FOR_UPDATE_SQL, [checkinId]);

    const row = existing.rows[0];
    if (!row || row.deleted_at !== null) throw new CheckInNotFoundError();
    if (row.user_id !== userId) throw new CheckInForbiddenError();

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (patch.scores !== undefined) {
      sets.push(`scores = $${idx++}::jsonb`);
      params.push(JSON.stringify(patch.scores));
    }
    if (patch.max_stay !== undefined) {
      sets.push(`max_stay = $${idx++}`);
      params.push(patch.max_stay);
    }
    if (patch.note !== undefined) {
      sets.push(`note = $${idx++}`);
      params.push(patch.note);
    }
    if (patch.visited_at !== undefined) {
      sets.push(`visited_at = $${idx++}`);
      params.push(patch.visited_at.toISOString());
    }

    if (sets.length === 0) return { cafeId: row.cafe_id };

    sets.push(`updated_at = now()`);
    const sql = `update checkins set ${sets.join(", ")} where id = $${idx}`;
    params.push(checkinId);
    await client.query(sql, params);

    await recomputeWorkStats(row.cafe_id, 0, txRunnerFrom(client));

    return { cafeId: row.cafe_id };
  });
}

export async function softDeleteCheckIn(userId: string, checkinId: string): Promise<{ cafeId: string }> {
  if (!isValidUUID(userId) || !isValidUUID(checkinId)) throw new Error("Invalid user or check-in ID");

  return withTransaction(async (client) => {
    const existing = await client.query<{
      id: string;
      cafe_id: string;
      user_id: string;
      deleted_at: string | null;
    }>(SELECT_CHECKIN_FOR_UPDATE_SQL, [checkinId]);

    const row = existing.rows[0];
    if (!row || row.deleted_at !== null) throw new CheckInNotFoundError();
    if (row.user_id !== userId) throw new CheckInForbiddenError();

    await client.query(
      `update checkins set deleted_at = now(), updated_at = now() where id = $1`,
      [checkinId],
    );

    // Hide this check-in's photos from the cafe gallery (source field).
    await client.query(
      `update cafes set gallery = coalesce(
         (select jsonb_agg(elem) from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) elem
          where not (elem->'source'->>'id' = $2)), '[]'::jsonb),
         updated_at = now()
       where id = $1`,
      [row.cafe_id, checkinId],
    );

    await recomputeWorkStats(row.cafe_id, 0, txRunnerFrom(client));

    return { cafeId: row.cafe_id };
  });
}
