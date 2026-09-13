import "server-only";

import { isValidUUID } from "@shared/uuid";
import {
  consumeProvisionedIntents,
  defaultProvisionPhotosDeps,
  provisionPhotos,
  type ProvisionPhotosDeps,
} from "@/lib/images/provision-photos";
import { recomputeWorkStats } from "@/lib/stats/aggregate";
import {
  CafeNotFoundError,
  DuplicateCheckInError,
  REVISIT_WINDOW_HOURS,
  type CreateCheckInInput,
} from "@/lib/validation/checkin";
import { query, txQueryFrom, txRunnerFrom, withTransaction } from "../postgres";
import { MERGE_GALLERY_SQL, photosWithSource } from "./gallery";

const CAFE_EXISTS_SQL = "select id from cafes where id = $1 and deleted_at is null";

/**
 * BRAWUKA-125: serialize concurrent creates for the same user+cafe.
 * Transaction-scoped (`pg_advisory_xact_lock` releases on commit/rollback,
 * safe under pooling — never `pg_advisory_lock`). First statement in the
 * transaction so a waiter holds no other lock (no deadlock cycle). A
 * `hashtext` collision only over-serializes unrelated pairs, never misses.
 * The waiter then re-reads committed rows (READ COMMITTED per-statement
 * snapshot) and hits the DG64 window check → DuplicateCheckInError.
 */
const ACQUIRE_CREATE_LOCK_SQL = "select pg_advisory_xact_lock(hashtext($1 || ':' || $2))";

/**
 * DG64 windowed existence check: the caller's latest live check-in for this
 * cafe inside the revisit window, if any. Runs inside the createCheckIn
 * transaction (after the cafe gate, before the insert) so a raced second
 * write cannot slip between check and insert.
 */
const SELECT_RECENT_CHECKIN_SQL = `
select id from checkins
where cafe_id = $1 and user_id = $2 and deleted_at is null
  and visited_at > now() - ($3 * interval '1 hour')
order by visited_at desc limit 1
`;

/**
 * DG61 idempotency lookup: a replayed key maps back to the original row.
 * No deleted_at filter: a replay must return the same id even if the row
 * was soft-deleted between attempts, never a second row. (Retry-after-delete
 * cannot happen via the drawer UI — retry exists only pre-success — so the
 * simple "same key, same id" rule holds everywhere.)
 */
const SELECT_IDEMPOTENT_CHECKIN_SQL = `
select id from checkins
where user_id = $1 and idempotency_key = $2
limit 1
`;

const INSERT_CHECKIN_SQL = `
insert into checkins (cafe_id, user_id, is_creation, scores, max_stay, note, photos, visited_at, idempotency_key)
values ($1, $2, false, $3, $4, $5, $6, coalesce($7, now()), $8)
on conflict (user_id, idempotency_key) where idempotency_key is not null do nothing
returning id
`;

/** Photos are written after the insert: their `source` needs the check-in id. */
const SET_CHECKIN_PHOTOS_SQL = `update checkins set photos = $2::jsonb where id = $1`;

/**
 * Create a regular (non-creation) check-in and refresh work_stats — all in
 * ONE transaction (the stats update is injected into the same connection;
 * a second transaction would self-deadlock on the cafe row's lock).
 * Photos auto-merge into cafes.gallery in the same transaction (spec 0001).
 *
 * Photos arrive as `photo_ids` (issue #86): intents are pre-checked and the
 * images processed (sharp) BEFORE the transaction (slow I/O must not hold a
 * DB connection); the single-use intent consume runs INSIDE it, so a replay
 * or foreign id rolls the whole check-in back.
 *
 * The stats refresh is a full `recomputeWorkStats`, not the incremental
 * fold: `incrementalUpdateWorkStats` assumes the just-written check-in is
 * the user's LATEST, but `visited_at` accepts any past timestamp — a
 * backdated visit would subtract the wrong "before" contribution and
 * corrupt the stats (independent review, PR B). A full recompute is
 * always correct and cheap at MVP scale (one cafe's check-ins).
 */

export async function createCheckIn(
  userId: string,
  input: CreateCheckInInput,
  deps: ProvisionPhotosDeps = defaultProvisionPhotosDeps(),
): Promise<{ checkinId: string; deduped: boolean }> {
  if (!isValidUUID(userId)) throw new Error("Invalid user ID");
  if (!isValidUUID(input.cafe_id)) throw new Error("Invalid cafe ID");
  if (input.idempotency_key !== undefined && !isValidUUID(input.idempotency_key)) {
    throw new Error("Invalid idempotency key");
  }

  const photoIds = input.photo_ids ?? [];
  const idempotencyKey = input.idempotency_key;

  // DG61 fast path: a replayed key returns the original id BEFORE photo
  // provisioning — the first attempt already consumed the single-use upload
  // intents, so provisioning again would fail the replay outright.
  if (idempotencyKey) {
    const replay = await query<{ id: string }>(SELECT_IDEMPOTENT_CHECKIN_SQL, [
      userId,
      idempotencyKey,
    ]);
    const replayId = replay.rows[0]?.id;
    if (replayId) return { checkinId: replayId, deduped: true };
  }

  // Fail fast on a missing cafe BEFORE provisioning — sharp processing is
  // wasted work otherwise. The in-transaction check below stays the
  // authoritative gate (the cafe could be deleted in between).
  const cafeExists = await query<{ id: string } & Record<string, unknown>>(CAFE_EXISTS_SQL, [
    input.cafe_id,
  ]);
  if (!cafeExists.rows[0]) throw new CafeNotFoundError(input.cafe_id);

  const provisioned = await provisionPhotos(userId, photoIds, deps);

  return withTransaction(async (client) => {
    // BRAWUKA-125: must be the first statement — waiters hold no other lock.
    await client.query(ACQUIRE_CREATE_LOCK_SQL, [userId, input.cafe_id]);
    const cafe = await client.query<{ id: string }>(CAFE_EXISTS_SQL, [input.cafe_id]);
    if (!cafe.rows[0]) throw new CafeNotFoundError(input.cafe_id);

    // DG64: at most 1 check-in per cafe per user per revisit window. A hit
    // means "edit the existing check-in" — the drawer preempts this, the
    // route maps it to 409 with the id for raced clients.
    const recent = await client.query<{ id: string }>(SELECT_RECENT_CHECKIN_SQL, [
      input.cafe_id,
      userId,
      REVISIT_WINDOW_HOURS,
    ]);
    const existingId = recent.rows[0]?.id;
    if (existingId) throw new DuplicateCheckInError(existingId);

    const res = await client.query<{ id: string }>(INSERT_CHECKIN_SQL, [
      input.cafe_id,
      userId,
      JSON.stringify(input.scores),
      input.max_stay ?? null,
      input.note ?? null,
      JSON.stringify([]),
      input.visited_at ?? null,
      idempotencyKey ?? null,
    ]);
    let checkinId = res.rows[0]?.id;
    let deduped = false;
    if (!checkinId && idempotencyKey) {
      // ON CONFLICT DO NOTHING swallowed a raced first attempt that
      // committed between the fast-path lookup and this insert: return its
      // id instead of a second row. (Without a key the insert always
      // returns a row; a missing id there is a real failure.)
      const raced = await client.query<{ id: string }>(SELECT_IDEMPOTENT_CHECKIN_SQL, [
        userId,
        idempotencyKey,
      ]);
      checkinId = raced.rows[0]?.id;
      deduped = Boolean(checkinId);
    }
    if (!checkinId) throw new Error("check-in insert returned no id");

    if (provisioned.length > 0) {
      // Single-use consume inside the tx: a replay/foreign id aborts the
      // whole check-in (issue #86).
      const q = txQueryFrom(client);
      await consumeProvisionedIntents(userId, photoIds, q, deps);
      const photos = photosWithSource(provisioned, checkinId);
      // $1 = checkin id, $2 = photos JSON (the SET clause's $2::jsonb).
      await client.query(SET_CHECKIN_PHOTOS_SQL, [checkinId, JSON.stringify(photos)]);
      await client.query(MERGE_GALLERY_SQL, [input.cafe_id, JSON.stringify(photos)]);
    }

    await recomputeWorkStats(input.cafe_id, 0, txRunnerFrom(client));

    return { checkinId, deduped };
  });
}
