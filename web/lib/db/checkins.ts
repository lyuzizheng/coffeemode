import "server-only";

import { isValidUUID } from "@shared/uuid";
import {
  consumeProvisionedIntents,
  defaultProvisionPhotosDeps,
  provisionPhotos,
  type ProvisionPhotosDeps,
  type ProvisionedPhoto,
} from "@/lib/images/provision-photos";
import {
  recomputeWorkStats,
  type RunInTransaction,
} from "@/lib/stats/aggregate";
import { WORK_DIMS } from "@/lib/stats/work-stats";
import {
  MAX_STAY_VALUES,
  type CheckInScores,
  type MaxStay,
} from "@/types/checkins";
import type { StoredImage } from "@/types/images";
import { appConfig } from "@/lib/config";
import { query, withTransaction } from "./postgres";
import type { PoolClient } from "pg";

/* ------------------------------------------------------------------ *
 * Shared payload parsing — the cafes creation flow (./cafes.ts)
 * reuses these for its fused first check-in.
 * ------------------------------------------------------------------ */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function fail<T>(message: string): ParseResult<T> {
  return { ok: false, message };
}

/** Score map keyed by WORK_DIMS, each 0-100. `field` prefixes error messages. */
export function parseScores(value: unknown, field = "scores"): ParseResult<CheckInScores> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(`${field} must be an object`);
  }
  const scores: CheckInScores = {};
  for (const [key, score] of Object.entries(value)) {
    if (!(WORK_DIMS as readonly string[]).includes(key)) {
      return fail(`${field}.${key} is not a known dimension`);
    }
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
      return fail(`${field}.${key} must be a number between 0 and 100`);
    }
    scores[key as keyof CheckInScores] = score;
  }
  return { ok: true, value: scores };
}

/** Structural check for client-supplied photo references (issue #86):
 *  plain imageUuids from /api/images/upload — never StoredImage payloads.
 *  The server derives keys/dimensions/attribution from upload intents.
 *  Product caps live in `web/config/app.yaml` (DG107). */
export const MAX_PHOTOS_PER_CHECKIN = appConfig.checkins.photoCap;

/** DG67 caps note at 500 chars (amends the earlier 1000); lives in config. */
export const MAX_NOTE_LENGTH = appConfig.checkins.noteMaxChars;

export function parsePhotoIds(value: unknown, field = "photo_ids"): ParseResult<string[]> {
  if (!Array.isArray(value)) return fail(`${field} must be an array of image UUIDs`);
  if (value.length > MAX_PHOTOS_PER_CHECKIN) {
    return fail(`${field} is limited to ${MAX_PHOTOS_PER_CHECKIN} photos`);
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !isValidUUID(entry)) {
      return fail(`${field} entries must be image UUIDs from /api/images/upload`);
    }
    const id = entry.toLowerCase();
    if (seen.has(id)) return fail(`${field} must not contain duplicates`);
    seen.add(id);
  }
  return { ok: true, value: [...seen] };
}

/** Optional ISO timestamp; must not be in the future. */
export function parseVisitedAt(value: unknown, field = "visited_at"): ParseResult<Date | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return fail(`${field} must be an ISO timestamp string`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fail(`${field} is not a parseable timestamp`);
  if (parsed.getTime() > Date.now()) return fail(`${field} cannot be in the future`);
  return { ok: true, value: parsed };
}

/* ------------------------------------------------------------------ *
 * Check-in creation
 * ------------------------------------------------------------------ */

/** Thrown when a write references a cafe that does not exist. */
export class CafeNotFoundError extends Error {
  constructor(readonly cafeId: string) {
    super("cafe not found");
    this.name = "CafeNotFoundError";
  }
}

/**
 * A regular (non-creation) check-in. Spec 0001:541 pins >=1 slider per
 * check-in (creation pins more); policies, note, and photos stay optional
 * extras here. Photos are plain image UUIDs (`photo_ids`) — the server
 * provisions them via upload intents and derives StoredImage (issue #86).
 */
export interface CreateCheckInInput {
  cafe_id: string;
  scores: CheckInScores;
  max_stay?: MaxStay;
  note?: string;
  photo_ids?: string[];
  visited_at?: Date;
}

/** Validate the POST /api/checkins body into a typed input. */
export function parseCheckInBody(body: unknown): ParseResult<CreateCheckInInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw.cafe_id !== "string" || !isValidUUID(raw.cafe_id)) {
    return fail("cafe_id (UUID string) required");
  }

  // >=1 slider per check-in (spec 0001:541) — the only required content.
  const parsedScores =
    raw.scores === undefined || raw.scores === null
      ? fail<CheckInScores>("scores with at least one dimension required (spec 0001)")
      : parseScores(raw.scores);
  if (!parsedScores.ok) return fail(parsedScores.message);
  const scores = parsedScores.value;
  if (Object.keys(scores).length === 0) {
    return fail("scores must contain at least one dimension (spec 0001)");
  }

  let maxStay: MaxStay | undefined;
  if (raw.max_stay !== undefined && raw.max_stay !== null) {
    if (!(MAX_STAY_VALUES as readonly string[]).includes(raw.max_stay as string)) {
      return fail(`max_stay must be one of ${MAX_STAY_VALUES.join("|")}`);
    }
    maxStay = raw.max_stay as MaxStay;
  }

  let note: string | undefined;
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== "string") return fail("note must be a string");
    const trimmed = raw.note.trim();
    if (trimmed.length > MAX_NOTE_LENGTH) return fail(`note is too long (max ${MAX_NOTE_LENGTH})`);
    if (trimmed !== "") note = trimmed;
  }

  let photoIds: string[] | undefined;
  if (raw.photo_ids !== undefined && raw.photo_ids !== null) {
    const parsed = parsePhotoIds(raw.photo_ids);
    if (!parsed.ok) return fail(parsed.message);
    if (parsed.value.length > 0) photoIds = parsed.value;
  }

  const visitedAt = parseVisitedAt(raw.visited_at);
  if (!visitedAt.ok) return fail(visitedAt.message);

  return {
    ok: true,
    value: {
      cafe_id: raw.cafe_id,
      scores,
      max_stay: maxStay,
      note,
      photo_ids: photoIds,
      visited_at: visitedAt.value,
    },
  };
}

const CAFE_EXISTS_SQL = "select id from cafes where id = $1 and deleted_at is null";

const INSERT_CHECKIN_SQL = `
insert into checkins (cafe_id, user_id, is_creation, scores, max_stay, note, photos, visited_at)
values ($1, $2, false, $3, $4, $5, $6, coalesce($7, now()))
returning id
`;

/** Photos are written after the insert: their `source` needs the check-in id. */
const SET_CHECKIN_PHOTOS_SQL = `update checkins set photos = $2::jsonb where id = $1`;

/**
 * Append check-in photos to cafes.gallery with provenance (spec 0001:
 * photos auto-merge, no curator approval at MVP; the `source` field on
 * server-derived photos lets gallery queries hide photos from soft-deleted
 * check-ins). Guarded per-element by photo id to prevent duplicate entries
 * even across timestamp re-stamping and partial array overlap (issues #234, #258).
 * Precondition: $2 array must not contain intra-array duplicate IDs (guaranteed
 * by parsePhotoIds validation on create paths and single-element inputs on complete).
 */
export const MERGE_GALLERY_SQL = `
update cafes
set gallery = coalesce(gallery, '[]'::jsonb) || (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements($2::jsonb) elem
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) g
    where g->>'id' = elem->>'id'
  )
)
where id = $1
`;

/** Attach the check-in id as each photo's `source` (soft-delete hiding). */
export function photosWithSource(photos: ProvisionedPhoto[], checkinId: string): StoredImage[] {
  return photos.map((p) => ({ ...p, source: { type: "checkin" as const, id: checkinId } }));
}

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
): Promise<{ checkinId: string }> {
  if (!isValidUUID(userId)) throw new Error("Invalid user ID");
  if (!isValidUUID(input.cafe_id)) throw new Error("Invalid cafe ID");

  const photoIds = input.photo_ids ?? [];

  // Fail fast on a missing cafe BEFORE provisioning — sharp processing is
  // wasted work otherwise. The in-transaction check below stays the
  // authoritative gate (the cafe could be deleted in between).
  const cafeExists = await query<{ id: string } & Record<string, unknown>>(CAFE_EXISTS_SQL, [
    input.cafe_id,
  ]);
  if (!cafeExists.rows[0]) throw new CafeNotFoundError(input.cafe_id);

  const provisioned = await provisionPhotos(userId, photoIds, deps);

  return withTransaction(async (client) => {
    const inSameTx: RunInTransaction = (fn) =>
      fn(<T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
        client.query<T>(text, params),
      );

    const cafe = await client.query<{ id: string }>(CAFE_EXISTS_SQL, [input.cafe_id]);
    if (!cafe.rows[0]) throw new CafeNotFoundError(input.cafe_id);

    const res = await client.query<{ id: string }>(INSERT_CHECKIN_SQL, [
      input.cafe_id,
      userId,
      JSON.stringify(input.scores),
      input.max_stay ?? null,
      input.note ?? null,
      JSON.stringify([]),
      input.visited_at ?? null,
    ]);
    const checkinId = res.rows[0]?.id;
    if (!checkinId) throw new Error("check-in insert returned no id");

    if (provisioned.length > 0) {
      // Single-use consume inside the tx: a replay/foreign id aborts the
      // whole check-in (issue #86).
      const q = client.query.bind(client) as Parameters<typeof consumeProvisionedIntents>[2];
      await consumeProvisionedIntents(userId, photoIds, q, deps);
      const photos = photosWithSource(provisioned, checkinId);
      // $1 = checkin id, $2 = photos JSON (the SET clause's $2::jsonb).
      await client.query(SET_CHECKIN_PHOTOS_SQL, [checkinId, JSON.stringify(photos)]);
      await client.query(MERGE_GALLERY_SQL, [input.cafe_id, JSON.stringify(photos)]);
    }

    await recomputeWorkStats(input.cafe_id, 0, inSameTx);

    return { checkinId };
  });
}

/* ------------------------------------------------------------------ *
 * Edit + soft delete — both recompute work_stats from scratch (spec 0001
 * §Aggregation: edit→recompute, soft-delete→recompute). Incremental fold is
 * not used here: it assumes the changed check-in is the latest for that
 * user, but visited_at can be backdated.
 * ------------------------------------------------------------------ */

export class CheckInForbiddenError extends Error {
  constructor(message = "not your check-in") {
    super(message);
    this.name = "CheckInForbiddenError";
  }
}

export interface UpdateCheckInInput {
  scores?: CheckInScores;
  max_stay?: MaxStay | null;
  note?: string | null;
  visited_at?: Date;
}

export function parseUpdateCheckInBody(body: unknown): ParseResult<UpdateCheckInInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const raw = body as Record<string, unknown>;
  const hasAny =
    "scores" in raw || "max_stay" in raw || "note" in raw || "visited_at" in raw;
  if (!hasAny) return fail("at least one of scores, max_stay, note, visited_at required");

  let scores: CheckInScores | undefined;
  if ("scores" in raw && raw.scores !== undefined) {
    if (raw.scores === null) return fail("scores must be an object when provided");
    const parsed = parseScores(raw.scores, "scores");
    if (!parsed.ok) return fail(parsed.message);
    if (Object.keys(parsed.value).length === 0) return fail("scores must contain at least one dimension");
    scores = parsed.value;
  }

  let maxStay: MaxStay | null | undefined;
  if ("max_stay" in raw) {
    const v = raw.max_stay;
    if (v === null) maxStay = null;
    else if (v === undefined) maxStay = undefined;
    else if (!(MAX_STAY_VALUES as readonly string[]).includes(v as string)) {
      return fail(`max_stay must be one of ${MAX_STAY_VALUES.join("|")} or null`);
    } else {
      maxStay = v as MaxStay;
    }
  }

  let note: string | null | undefined;
  if ("note" in raw) {
    const v = raw.note;
    if (v === null) note = null;
    else if (v === undefined) note = undefined;
    else if (typeof v !== "string") return fail("note must be a string or null");
    else {
      const trimmed = v.trim();
      if (trimmed.length > MAX_NOTE_LENGTH) return fail(`note is too long (max ${MAX_NOTE_LENGTH})`);
      note = trimmed === "" ? null : trimmed;
    }
  }

  let visitedAt: Date | undefined;
  if ("visited_at" in raw && raw.visited_at !== undefined && raw.visited_at !== null) {
    const parsed = parseVisitedAt(raw.visited_at, "visited_at");
    if (!parsed.ok) return fail(parsed.message);
    visitedAt = parsed.value;
  } else if ("visited_at" in raw && raw.visited_at === null) {
    // explicit null is not allowed — visited_at stays as-is or is set to a date
    return fail("visited_at cannot be null");
  }

  return { ok: true, value: { scores, max_stay: maxStay, note, visited_at: visitedAt } };
}

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
    const inSameTx: RunInTransaction = (fn) =>
      fn(<T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
        client.query<T>(text, params),
      );

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

    await recomputeWorkStats(row.cafe_id, 0, inSameTx);

    return { cafeId: row.cafe_id };
  });
}

export async function softDeleteCheckIn(userId: string, checkinId: string): Promise<{ cafeId: string }> {
  if (!isValidUUID(userId) || !isValidUUID(checkinId)) throw new Error("Invalid user or check-in ID");

  return withTransaction(async (client) => {
    const inSameTx: RunInTransaction = (fn) =>
      fn(<T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
        client.query<T>(text, params),
      );

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

    await recomputeWorkStats(row.cafe_id, 0, inSameTx);

    return { cafeId: row.cafe_id };
  });
}

/* ------------------------------------------------------------------ *
 * Likes
 * ------------------------------------------------------------------ */

/** Thrown when a like targets a check-in that is missing or soft-deleted. */
export class CheckInNotFoundError extends Error {
  constructor() {
    super("Check-in not found or deleted");
    this.name = "CheckInNotFoundError";
  }
}

/** Thrown when the caller tries to like their own check-in (issue #107). */
export class SelfLikeError extends Error {
  constructor() {
    super("You cannot like your own check-in");
    this.name = "SelfLikeError";
  }
}

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

const OWNS_CHECKIN_SQL = `
select cafe_id from checkins where id = $1 and user_id = $2 and deleted_at is null
`;

export async function ownsCheckin(
  checkinId: string,
  userId: string,
  q = query,
): Promise<boolean> {
  if (!isValidUUID(checkinId) || !isValidUUID(userId)) return false;
  const result = await q<{ cafe_id: string | null }>(OWNS_CHECKIN_SQL, [checkinId, userId]);
  return result.rows.length > 0;
}

const ATTACH_IMAGE_TO_CHECKIN_SQL = `
update checkins
set photos = coalesce(photos, '[]'::jsonb) || (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements($1::jsonb) elem
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(photos, '[]'::jsonb)) g
    where g->>'id' = elem->>'id'
  )
)
where id = $2 and user_id = $3 and deleted_at is null
returning id, cafe_id
`;

export async function attachImageToCheckin(
  params: {
    checkinId: string;
    userId: string;
    image: StoredImage;
  },
  q = query,
): Promise<{ ok: boolean; cafeId: string | null }> {
  const result = await q<{ id: string; cafe_id: string | null }>(
    ATTACH_IMAGE_TO_CHECKIN_SQL,
    [JSON.stringify([params.image]), params.checkinId, params.userId],
  );
  if (result.rows.length === 0) return { ok: false, cafeId: null };
  return { ok: true, cafeId: result.rows[0].cafe_id };
}

export async function mergeIntoCafeGallery(
  cafeId: string,
  image: StoredImage,
  q = query,
): Promise<void> {
  await q(MERGE_GALLERY_SQL, [cafeId, JSON.stringify([image])]);
}
