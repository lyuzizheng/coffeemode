import "server-only";

import { isValidUUID } from "@shared/uuid";
import { recomputeWorkStats } from "@/lib/stats/aggregate";
import { CafeNotFoundError } from "@/lib/validation/checkin";
import {
  CafeForbiddenError,
  CafeHasOtherCheckinsError,
} from "@/lib/validation/cafe";
import { txRunnerFrom, withTransaction } from "../postgres";
import { getServiceAccountId } from "./meta";

export interface DeleteCafeResult {
  ok: true;
  id: string;
  removed_checkins: number;
  owner_transferred: boolean;
  shell: boolean;
}

/**
 * Cafe deletion is checkin-scoped and never deletes the cafe row (DG125).
 * Creator-only. Inside a single FOR UPDATE transaction:
 * - Counts other users' live checkins (`user_id <> caller`).
 * - If others >= 1 and `options?.confirm !== true` -> throws CafeHasOtherCheckinsError(others).
 * - Soft-deletes all caller's live checkins, hides photos from gallery, recomputes work_stats.
 * - If others >= 1: updates `created_by` to the service account.
 * - Returns { ok: true, id, removed_checkins: k, owner_transferred: others >= 1, shell: others === 0 }.
 *
 * Idempotency:
 * - Repeat after handoff: created_by moved -> throws CafeForbiddenError (403).
 * - Repeat on own shell: 0 own live checkins -> throws CafeNotFoundError (404).
 */

export async function deleteCafe(
  cafeId: string,
  userId: string,
  options?: { confirm?: boolean },
): Promise<DeleteCafeResult> {
  if (!isValidUUID(cafeId) || !isValidUUID(userId)) {
    throw new CafeNotFoundError(cafeId);
  }

  return withTransaction(async (client) => {
    const cafeRes = await client.query<{
      id: string;
      created_by: string | null;
      deleted_at: string | null;
    }>(
      `select id, created_by, deleted_at from cafes where id = $1 for update`,
      [cafeId],
    );
    const cafeRow = cafeRes.rows[0];
    if (!cafeRow || cafeRow.deleted_at !== null) {
      throw new CafeNotFoundError(cafeId);
    }

    if (cafeRow.created_by !== userId) {
      throw new CafeForbiddenError();
    }

    const othersRes = await client.query<{ count: string }>(
      `select count(*)::text from checkins where cafe_id = $1 and deleted_at is null and user_id <> $2`,
      [cafeId, userId],
    );
    const others = Number.parseInt(othersRes.rows[0]?.count ?? "0", 10);

    const callerCheckinsRes = await client.query<{ id: string }>(
      `select id from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null for update`,
      [cafeId, userId],
    );
    const callerCheckinIds = callerCheckinsRes.rows.map((r) => r.id);
    const k = callerCheckinIds.length;

    // If other users have live checkins, confirmation is required before handoff / mutation
    if (others >= 1 && !options?.confirm) {
      throw new CafeHasOtherCheckinsError(others);
    }

    // Repeat on own shell: 0 own live checkins and 0 others -> 404 nothing to delete
    if (k === 0 && others === 0) {
      throw new CafeNotFoundError(cafeId);
    }

    if (k > 0) {
      await client.query(
        `update checkins set deleted_at = now(), updated_at = now()
         where cafe_id = $1 and user_id = $2 and deleted_at is null`,
        [cafeId, userId],
      );

      await client.query(
        `update cafes set gallery = coalesce(
           (select jsonb_agg(elem) from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) elem
            where elem->'source'->>'id' is null or not (elem->'source'->>'id' = any($2::text[]))), '[]'::jsonb),
           updated_at = now()
         where id = $1`,
        [cafeId, callerCheckinIds],
      );

      await recomputeWorkStats(cafeId, 0, txRunnerFrom(client));
    }

    const ownerTransferred = others >= 1;
    if (ownerTransferred) {
      const serviceAccountId = getServiceAccountId();
      await client.query(
        `update cafes set created_by = $2 where id = $1 and created_by = $3`,
        [cafeId, serviceAccountId, userId],
      );
    }

    return {
      ok: true,
      id: cafeId,
      removed_checkins: k,
      owner_transferred: ownerTransferred,
      shell: others === 0,
    };
  });
}
