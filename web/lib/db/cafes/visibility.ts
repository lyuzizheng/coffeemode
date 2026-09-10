import "server-only";

import { isValidUUID } from "@shared/uuid";
import type { CafeVisibility } from "@/types/cafes";
import { CafeNotFoundError } from "@/lib/validation/checkin";
import { CafeForbiddenError } from "@/lib/validation/cafe";
import { query } from "../postgres";

export interface SetCafeVisibilityResult {
  ok: true;
  id: string;
  visibility: CafeVisibility;
}

/**
 * Toggles cafe visibility between 'public' and 'private' (DG147 / issue #229).
 * Reversible, creator-only toggle. Idempotent.
 */
export async function setCafeVisibility(
  cafeId: string,
  userId: string,
  visibility: CafeVisibility,
): Promise<SetCafeVisibilityResult> {
  if (!isValidUUID(cafeId) || !isValidUUID(userId)) {
    throw new CafeNotFoundError(cafeId);
  }
  if (visibility !== "public" && visibility !== "private") {
    throw new Error("visibility must be 'public' or 'private'");
  }

  const res = await query<{
    id: string;
    created_by: string | null;
    visibility: CafeVisibility;
    deleted_at: string | null;
  }>(
    `select id, created_by, visibility, deleted_at from cafes where id = $1`,
    [cafeId],
  );
  const row = res.rows[0];
  if (!row || row.deleted_at !== null) {
    throw new CafeNotFoundError(cafeId);
  }

  if (row.created_by !== userId) {
    // Covers non-owner and null created_by
    throw new CafeForbiddenError("only creator can change cafe visibility");
  }

  if (row.visibility === visibility) {
    return { ok: true, id: cafeId, visibility };
  }

  await query(
    `update cafes set visibility = $2, updated_at = now() where id = $1`,
    [cafeId, visibility],
  );

  return { ok: true, id: cafeId, visibility };
}
