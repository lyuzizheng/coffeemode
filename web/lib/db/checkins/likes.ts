import "server-only";

import { isValidUUID } from "@shared/uuid";
import type { PoolClient } from "pg";
import {
  CheckInNotFoundError,
  SelfLikeError,
} from "@/lib/validation/checkin";
import { withTransaction } from "../postgres";

/* ------------------------------------------------------------------ *
 * Likes
 * ------------------------------------------------------------------ */

export interface ToggleLikeResult {
  liked: boolean;
  likesCount: number;
}

const TOGGLE_LIKE_SQL = `
WITH checkin AS (
  SELECT id, user_id FROM checkins WHERE id = $2 AND deleted_at IS NULL FOR UPDATE
),
deleted AS (
  DELETE FROM checkin_likes
  WHERE user_id = $1 AND checkin_id = $2
    AND checkin_id IN (SELECT id FROM checkin)
  RETURNING id
),
inserted AS (
  INSERT INTO checkin_likes (user_id, checkin_id)
  SELECT $1, $2
  WHERE NOT EXISTS (SELECT 1 FROM deleted)
    AND EXISTS (SELECT 1 FROM checkin)
    AND (SELECT user_id FROM checkin) <> $1
  RETURNING id
)
SELECT
  (SELECT count(*)::int FROM checkin) AS checkin_count,
  (SELECT count(*)::int FROM inserted) AS inserted_count,
  (SELECT count(*)::int FROM deleted) AS deleted_count,
  (SELECT user_id FROM checkin) = $1 AS is_author
`;

function validateIds(userId: string, checkinId: string) {
  if (!isValidUUID(userId) || !isValidUUID(checkinId)) {
    throw new Error("Invalid user or check-in ID");
  }
}

/**
 * Atomically toggle a like on a check-in and keep `checkins.likes_count`
 * in sync with the `checkin_likes` table in one transaction.
 *
 * Returns `{ liked: true, likesCount }` when the like was added and
 * `{ liked: false, likesCount }` when it was removed. Throws
 * `CheckInNotFoundError` if the check-in does not exist or is soft-deleted.
 *
 * Self-likes are not allowed (issue #107): the insert is gated on
 * `caller <> checkins.user_id`, so liking your own check-in throws
 * `SelfLikeError`. Un-liking a legacy self-like row written before the rule
 * still works — it is cleaned up and `liked` comes back `false`. Migration
 * 0008's BEFORE INSERT trigger is the same rule at the DB level for any
 * writer that bypasses this function.
 */

export async function toggleCheckInLike(
  userId: string,
  checkinId: string,
): Promise<ToggleLikeResult> {
  validateIds(userId, checkinId);

  return withTransaction(async (client: PoolClient) => {
    const result = await client.query<{
      checkin_count: number;
      inserted_count: number;
      deleted_count: number;
      is_author: boolean | null;
    }>(TOGGLE_LIKE_SQL, [userId, checkinId]);

    const row = result.rows[0];
    if (!row || row.checkin_count === 0) {
      throw new CheckInNotFoundError();
    }

    if (row.is_author && row.deleted_count === 0) {
      throw new SelfLikeError();
    }

    // The 0004 AFTER trigger has already recomputed likes_count in its own
    // sub-statement snapshot. Read the now-committed value in a separate
    // statement so we never update the same checkins row twice in one query.
    const { rows: countRows } = await client.query<{ likes_count: number }>(
      "SELECT likes_count FROM checkins WHERE id = $1",
      [checkinId],
    );

    return {
      liked: row.inserted_count > 0,
      likesCount: countRows[0]?.likes_count ?? 0,
    };
  });
}
