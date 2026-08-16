import "server-only";

import type { QueryResult } from "pg";
import { isValidUUID } from "@shared/uuid";
import { query } from "./postgres";

/** Minimal query-fn shape so consume can run on a transaction connection. */
export type IntentQueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/**
 * Upload intents (issue #33): bind a presigned imageUuid to the user it
 * was issued to, so a leaked upload URL cannot be completed by someone
 * else against a target they own. Table: migration 0006.
 */

/** Freshness margin over the 10min presigned-URL TTL (image-service). */
const INTENT_WINDOW = "1 hour";

/** Record that `imageUuid`'s upload URL was issued to `userId`. */
export async function recordUploadIntent(userId: string, imageUuid: string): Promise<void> {
  if (!isValidUUID(userId) || !isValidUUID(imageUuid)) {
    throw new Error("Invalid user or image ID");
  }
  await query(
    "insert into image_upload_intents (image_uuid, user_id) values ($1, $2)",
    [imageUuid, userId],
  );
}

/**
 * Read-only pre-check before any remote work: was this imageUuid issued
 * to this user, within the freshness window? Fail-fast so an unauthorized
 * caller cannot burn image-service presign/sharp resources.
 */
export async function checkUploadIntent(userId: string, imageUuid: string): Promise<boolean> {
  if (!isValidUUID(userId) || !isValidUUID(imageUuid)) return false;
  const { rows } = await query<{ image_uuid: string } & Record<string, unknown>>(
    `select image_uuid from image_upload_intents
     where image_uuid = $1 and user_id = $2
       and created_at > now() - interval '${INTENT_WINDOW}'`,
    [imageUuid, userId],
  );
  return rows.length > 0;
}

/**
 * Consume the intent: single-use DELETE ... RETURNING. 0 rows = not
 * issued to this user, expired, or a replay — the caller must treat the
 * complete as failed. Pass the transaction's query fn (`q`) so the
 * consume commits or rolls back WITH the attach writes; consuming at
 * commit (not at the pre-check) means a transient processing failure
 * doesn't force a re-upload.
 */
export async function consumeUploadIntent(
  userId: string,
  imageUuid: string,
  q: IntentQueryFn = query,
): Promise<boolean> {
  if (!isValidUUID(userId) || !isValidUUID(imageUuid)) return false;
  const { rows } = await q<{ image_uuid: string }>(
    `delete from image_upload_intents
     where image_uuid = $1 and user_id = $2
       and created_at > now() - interval '${INTENT_WINDOW}'
     returning image_uuid`,
    [imageUuid, userId],
  );
  return rows.length > 0;
}
