import "server-only";

import { isValidUUID } from "@shared/uuid";
import {
  attachProvisionedPhotos,
  compensateProvisionedPhotos,
  consumeProvisionedIntents,
  defaultProvisionPhotosDeps,
  provisionPhotos,
  type ProvisionedPhoto,
  type ProvisionPhotosDeps,
} from "@/lib/images/provision-photos";
import { recomputeWorkStats } from "@/lib/stats/aggregate";
import type { PoolClient } from "pg";
import {
  CheckInForbiddenError,
  CheckInNotFoundError,
  CheckInPhotoLimitError,
  MAX_PHOTOS_PER_CHECKIN,
  type UpdateCheckInInput,
} from "@/lib/validation/checkin";
import { txQueryFrom, txRunnerFrom, withTransaction } from "../postgres";
import { MERGE_GALLERY_SQL, photosWithSource } from "./gallery";
import type { StoredImage } from "@/types/images";

/* ------------------------------------------------------------------ *
 * Edit + soft delete — both recompute work_stats from scratch (spec 0001
 * §Aggregation: edit→recompute, soft-delete→recompute). Incremental fold is
 * not used here: it assumes the changed check-in is the latest for that
 * user, but visited_at can be backdated.
 * ------------------------------------------------------------------ */

/**
 * Check-in edit and soft-delete take the parent cafe-row lock before the
 * check-in-row lock — the same cafe → checkin order deleteCafe and
 * deleteAccount use. A bare SELECT on the check-in row first would lock
 * checkin → cafe while deleteAccount locks cafe → checkin; on the same pair
 * that is the classic opposite-order deadlock. The cafe id comes from the
 * check-in's own row, so the lookup reads it lock-free (READ COMMITTED
 * latest committed) and then acquires both locks in order; the subsequent
 * SELECT ... FOR UPDATE re-validates the row after the locks are held.
 */
const SELECT_CHECKIN_CAFE_ID_SQL = `select cafe_id from checkins where id = $1`;
const LOCK_CAFE_ROW_SQL = `select 1 from cafes where id = $1 for update`;
const SELECT_CHECKIN_FOR_UPDATE_SQL = `
 select id, cafe_id, user_id, is_creation, scores, max_stay, note, photos, visited_at, deleted_at
 from checkins where id = $1 for update
`;

interface LockedCheckInRow {
  id: string;
  cafe_id: string;
  user_id: string;
  photos: StoredImage[] | null;
  deleted_at: string | null;
}

async function lockCheckInCafeFirst(
  client: PoolClient,
  checkinId: string,
): Promise<LockedCheckInRow | undefined> {
  const cafeLookup = await client.query<{ cafe_id: string }>(SELECT_CHECKIN_CAFE_ID_SQL, [checkinId]);
  const cafeId = cafeLookup.rows[0]?.cafe_id;
  // Missing row: nothing to lock — the caller maps it to 404 below.
  if (cafeId !== undefined) {
    await client.query(LOCK_CAFE_ROW_SQL, [cafeId]);
  }
  const existing = await client.query<LockedCheckInRow>(SELECT_CHECKIN_FOR_UPDATE_SQL, [checkinId]);
  return existing.rows[0];
}

/**
 * Drop the removed photos' gallery entries — scoped by BOTH the image id
 * and this check-in's `source` so a same-id entry from another source can
 * never be caught in the filter (same guard shape as softDeleteCheckIn).
 */
const REMOVE_GALLERY_PHOTOS_SQL = `
update cafes set gallery = coalesce(
  (select jsonb_agg(elem) from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) elem
   where not (elem->'source'->>'id' = $2 and elem->>'id' = any($3::text[]))), '[]'::jsonb),
  updated_at = now()
where id = $1
`;

interface PhotoDeltaArgs {
  client: PoolClient;
  userId: string;
  checkinId: string;
  row: LockedCheckInRow;
  removePhotoIds: string[];
  addPhotoIds: string[];
  provisioned: ProvisionedPhoto[];
  deps: ProvisionPhotosDeps;
}

/**
 * The photo-delta half of an edit (BRAWUKA-563): diff `remove_photo_ids`
 * against the locked row's photos, cap the result, consume the added ids'
 * intents inside the tx, and return the new photos array + the ids actually
 * detached (for the gallery cleanup and the post-commit R2 compensation).
 * `null` photos means the delta changed nothing.
 */
async function applyPhotoDelta(
  args: PhotoDeltaArgs,
): Promise<{ photos: StoredImage[] | null; detachedPhotoIds: string[] }> {
  const { client, userId, checkinId, row, removePhotoIds, addPhotoIds, provisioned, deps } = args;
  const existingPhotos = Array.isArray(row.photos) ? row.photos : [];
  const removeSet = new Set(removePhotoIds);
  const keptPhotos = existingPhotos.filter((p) => !removeSet.has(p.id ?? ""));
  if (keptPhotos.length + provisioned.length > MAX_PHOTOS_PER_CHECKIN) {
    throw new CheckInPhotoLimitError();
  }
  if (provisioned.length === 0 && keptPhotos.length === existingPhotos.length) {
    return { photos: null, detachedPhotoIds: [] };
  }
  const detachedPhotoIds = existingPhotos
    .map((p) => p.id)
    .filter((id): id is string => typeof id === "string" && removeSet.has(id));
  // Single-use consume inside the tx: a replay/foreign id aborts the whole
  // edit (issue #86). New photos carry this check-in's `source` so
  // soft-delete hiding and gallery removal keep working.
  if (provisioned.length > 0) {
    await consumeProvisionedIntents(userId, addPhotoIds, txQueryFrom(client), deps);
  }
  return {
    photos: [...keptPhotos, ...photosWithSource(provisioned, checkinId)],
    detachedPhotoIds,
  };
}

/** The locked-row update: field SETs + photo delta + gallery sync + stats. */
async function applyCheckInPatch(args: {
  client: PoolClient;
  userId: string;
  checkinId: string;
  patch: UpdateCheckInInput;
  provisioned: ProvisionedPhoto[];
  deps: ProvisionPhotosDeps;
}): Promise<{ cafeId: string; detachedPhotoIds: string[] }> {
  const { client, userId, checkinId, patch, provisioned, deps } = args;
  const row = await lockCheckInCafeFirst(client, checkinId);
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

  const delta = await applyPhotoDelta({
    client,
    userId,
    checkinId,
    row,
    removePhotoIds: patch.remove_photo_ids ?? [],
    addPhotoIds: patch.add_photo_ids ?? [],
    provisioned,
    deps,
  });
  if (delta.photos !== null) {
    sets.push(`photos = $${idx++}::jsonb`);
    params.push(JSON.stringify(delta.photos));
  }

  if (sets.length === 0) return { cafeId: row.cafe_id, detachedPhotoIds: [] };

  sets.push(`updated_at = now()`);
  const sql = `update checkins set ${sets.join(", ")} where id = $${idx}`;
  params.push(checkinId);
  await client.query(sql, params);

  if (provisioned.length > 0) {
    const photos = photosWithSource(provisioned, checkinId);
    await client.query(MERGE_GALLERY_SQL, [row.cafe_id, JSON.stringify(photos)]);
  }
  if (delta.detachedPhotoIds.length > 0) {
    await client.query(REMOVE_GALLERY_PHOTOS_SQL, [row.cafe_id, checkinId, delta.detachedPhotoIds]);
  }

  await recomputeWorkStats(row.cafe_id, 0, txRunnerFrom(client));

  return { cafeId: row.cafe_id, detachedPhotoIds: delta.detachedPhotoIds };
}

export async function updateCheckIn(
  userId: string,
  checkinId: string,
  patch: UpdateCheckInInput,
  deps: ProvisionPhotosDeps = defaultProvisionPhotosDeps(),
): Promise<{ cafeId: string }> {
  if (!isValidUUID(userId) || !isValidUUID(checkinId)) throw new Error("Invalid user or check-in ID");

  const addPhotoIds = patch.add_photo_ids ?? [];

  // Same shape as createCheckIn: intents pre-checked and images processed
  // BEFORE the transaction (slow I/O must not hold a DB connection); the
  // single-use consume runs INSIDE it so a replay/foreign id rolls the
  // whole edit back (issue #86).
  const provisioned = await provisionPhotos(userId, addPhotoIds, deps);

  let updated: { cafeId: string };
  let detachedPhotoIds: string[] = [];
  try {
    updated = await withTransaction(async (client) => {
      const result = await applyCheckInPatch({ client, userId, checkinId, patch, provisioned, deps });
      detachedPhotoIds = result.detachedPhotoIds;
      return { cafeId: result.cafeId };
    });
  } catch (err) {
    // Rolled back: the provisioned R2 variants survive — compensate
    // best-effort (reference + live-intent gates inside; #158 sweeper is
    // the backstop). Mirrors createCheckIn's catch.
    if (provisioned.length > 0) await compensateProvisionedPhotos(userId, addPhotoIds, deps);
    throw err;
  }

  // Post-commit attach re-mark (BRAWUKA-400): re-mark live originals from
  // "provision" to "checkin" AFTER commit — slow I/O off the DB connection,
  // attach failures never fail the committed edit.
  if (provisioned.length > 0) {
    await attachProvisionedPhotos(userId, addPhotoIds, checkinId, deps);
  }
  // Detached photos are now unreferenced: best-effort R2 cleanup through the
  // same gated compensation path (the sweeper covers whatever it skips).
  if (detachedPhotoIds.length > 0) {
    await compensateProvisionedPhotos(userId, detachedPhotoIds, deps);
  }
  return updated;
}

export async function softDeleteCheckIn(userId: string, checkinId: string): Promise<{ cafeId: string }> {
  if (!isValidUUID(userId) || !isValidUUID(checkinId)) throw new Error("Invalid user or check-in ID");

  return withTransaction(async (client) => {
    const row = await lockCheckInCafeFirst(client, checkinId);
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
          where elem->'source'->>'id' is null or not (elem->'source'->>'id' = $2)), '[]'::jsonb),
         updated_at = now()
       where id = $1`,
      [row.cafe_id, checkinId],
    );

    await recomputeWorkStats(row.cafe_id, 0, txRunnerFrom(client));

    return { cafeId: row.cafe_id };
  });
}
