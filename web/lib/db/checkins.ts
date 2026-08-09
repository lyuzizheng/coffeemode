import "server-only";

import { isValidUUID } from "@shared/uuid";
import { withTransaction } from "./postgres";
import type { PoolClient } from "pg";

export interface ToggleLikeResult {
  liked: boolean;
  likesCount: number;
}

const TOGGLE_LIKE_SQL = `
WITH checkin AS (
  SELECT id FROM checkins WHERE id = $2 AND deleted_at IS NULL FOR UPDATE
),
deleted AS (
  DELETE FROM checkin_likes
  WHERE user_id = $1 AND checkin_id = $2
  RETURNING id
),
inserted AS (
  INSERT INTO checkin_likes (user_id, checkin_id)
  SELECT $1, $2
  WHERE NOT EXISTS (SELECT 1 FROM deleted)
    AND EXISTS (SELECT 1 FROM checkin)
  RETURNING id
)
UPDATE checkins
SET
  likes_count = (SELECT count(*)::int FROM checkin_likes WHERE checkin_id = $2),
  updated_at = now()
WHERE id = (SELECT id FROM checkin)
RETURNING
  likes_count,
  (SELECT count(*)::int FROM deleted) AS deleted_count,
  (SELECT count(*)::int FROM inserted) AS inserted_count
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
 * `{ liked: false, likesCount }` when it was removed. Throws if the
 * check-in does not exist or is soft-deleted.
 */
export async function toggleCheckInLike(
  userId: string,
  checkinId: string,
): Promise<ToggleLikeResult> {
  validateIds(userId, checkinId);

  return withTransaction(async (client: PoolClient) => {
    const result = await client.query<{
      likes_count: number;
      deleted_count: number;
      inserted_count: number;
    }>(TOGGLE_LIKE_SQL, [userId, checkinId]);

    const row = result.rows[0];
    if (!row) {
      throw new Error("Check-in not found or deleted");
    }

    return {
      liked: row.inserted_count > 0,
      likesCount: row.likes_count,
    };
  });
}
