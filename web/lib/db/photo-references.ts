import "server-only";

import { isValidUUID } from "@shared/uuid";
import { query, type TxQueryFn } from "./postgres";

/**
 * Minimal query-fn shape so the reference check can run on either the shared
 * pool (post-rollback compensation) or a transaction connection (tests).
 * Canonical shape lives in `./postgres` (spec 0009 §Edge cases 6).
 */
export type ReferenceQueryFn = TxQueryFn;

/**
 * Live-photo reference query (BRAWUKA-401): every `cafes.gallery[]` /
 * `checkins.photos[]` element whose `id` is one of the candidates. The
 * check-ins scope unions every row — a soft-deleted check-in's photos stay
 * DB-referenced until the row itself is gone, so they protect the R2
 * objects the same way live rows do. Same source set as the
 * `export-live-image-keys.mjs` live-keys export (which matches on
 * `original/` keys instead of ids) — the export feeds the #158 sweeper,
 * this feeds the rollback compensation gate; both answer "is this photo
 * still DB-referenced?" and must stay in lockstep when a new photo-bearing
 * surface appears.
 *
 * Runs on the caller's query fn (`query` in production — compensation fires
 * after the creation transaction already rolled back, so no transaction is
 * open). Invalid ids never match a row and are excluded from the result.
 */
export async function selectPhotoReferences(
  imageUuids: string[],
  q: ReferenceQueryFn = query,
): Promise<string[]> {
  const ids = imageUuids.filter((id) => isValidUUID(id));
  if (ids.length === 0) return [];
  const { rows } = await q<{ id: string }>(
    `select distinct elem->>'id' as id from (` +
      `select gallery as arr from cafes where deleted_at is null and gallery is not null` +
      ` union all ` +
      `select photos as arr from checkins where photos is not null` +
      `) t, jsonb_array_elements(t.arr) elem where elem->>'id' = any($1)`,
    [ids],
  );
  return rows.map((row) => row.id).filter((id) => typeof id === "string");
}
