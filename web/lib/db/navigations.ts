import "server-only";

import { isValidUUID } from "@shared/uuid";
import { cafeExists } from "./cafes";
import { CafeNotFoundError, fail, type ParseResult } from "./checkins";
import { query } from "./postgres";

/** A row in the `navigations` table — one "导航" tap (spec 0001). */
export interface RecordedNavigation {
  id: string;
  resolved: boolean;
  created_at: string;
}

/** Validate the POST /api/navigations body. */
export function parseNavigationBody(body: unknown): ParseResult<{ cafe_id: string }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const cafeId = (body as Record<string, unknown>).cafe_id;
  if (typeof cafeId !== "string" || !isValidUUID(cafeId)) {
    return fail("cafe_id (UUID string) required");
  }
  return { ok: true, value: { cafe_id: cafeId } };
}

const INSERT_NAVIGATION_SQL = `
insert into navigations (cafe_id, user_id)
values ($1, $2)
returning id, resolved, created_at
`;

/**
 * Record a navigation intent ("导航" tap). Drives the ClassPass-style
 * "did you visit?" prompt on the next visit (spec 0001); the prompt
 * trigger itself (>30min, 1/session) is client/API5 concern, not this
 * write path. Throws CafeNotFoundError when the cafe does not exist.
 */
export async function recordNavigation(
  userId: string,
  cafeId: string,
): Promise<RecordedNavigation> {
  if (!isValidUUID(userId)) throw new Error("Invalid user ID");
  if (!isValidUUID(cafeId)) throw new Error("Invalid cafe ID");

  // Explicit existence check so a missing cafe is a 404, not an FK 500.
  const exists = await cafeExists(cafeId);
  if (!exists) throw new CafeNotFoundError(cafeId);

  const { rows } = await query<RecordedNavigation & Record<string, unknown>>(
    INSERT_NAVIGATION_SQL,
    [cafeId, userId],
  );
  const row = rows[0];
  if (!row) throw new Error("navigation insert returned no row");
  return row;
}
