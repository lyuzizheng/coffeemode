import "server-only";

import { isValidUUID } from "@shared/uuid";
import {
  recomputeWorkStats,
  type RunInTransaction,
} from "@/lib/stats/aggregate";
import { WORK_DIMS } from "@/lib/stats/work-stats";
import {
  MAX_STAY_VALUES,
  MIN_SPEND_VALUES,
  type CheckInScores,
  type MaxStay,
  type MinSpend,
} from "@/types/checkins";
import type { StoredImage } from "@/types/images";
import { withTransaction } from "./postgres";
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

/** Structural check for StoredImage refs already processed by image-service. */
export function parsePhotos(value: unknown, field = "photos"): ParseResult<StoredImage[]> {
  if (!Array.isArray(value)) return fail(`${field} must be an array`);
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return fail(`${field} entries must be objects`);
    }
    const img = entry as Record<string, unknown>;
    for (const key of ["id", "original", "card", "thumbnail", "by", "at"] as const) {
      if (typeof img[key] !== "string" || (img[key] as string).trim() === "") {
        return fail(`${field}[].${key} must be a non-empty string`);
      }
    }
    if (Number.isNaN(Date.parse(img.at as string))) {
      return fail(`${field}[].at must be an ISO timestamp`);
    }
    for (const key of ["w", "h"] as const) {
      if (typeof img[key] !== "number" || !Number.isFinite(img[key]) || (img[key] as number) <= 0) {
        return fail(`${field}[].${key} must be a positive number`);
      }
    }
  }
  return { ok: true, value: value as StoredImage[] };
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
 * extras here.
 */
export interface CreateCheckInInput {
  cafe_id: string;
  scores: CheckInScores;
  min_spend?: MinSpend;
  max_stay?: MaxStay;
  note?: string;
  photos?: StoredImage[];
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

  let minSpend: MinSpend | undefined;
  if (raw.min_spend !== undefined && raw.min_spend !== null) {
    if (!(MIN_SPEND_VALUES as readonly string[]).includes(raw.min_spend as string)) {
      return fail(`min_spend must be one of ${MIN_SPEND_VALUES.join("|")}`);
    }
    minSpend = raw.min_spend as MinSpend;
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
    if (trimmed.length > 1000) return fail("note is too long (max 1000)");
    if (trimmed !== "") note = trimmed;
  }

  let photos: StoredImage[] | undefined;
  if (raw.photos !== undefined && raw.photos !== null) {
    const parsed = parsePhotos(raw.photos);
    if (!parsed.ok) return fail(parsed.message);
    if (parsed.value.length > 0) photos = parsed.value;
  }

  const visitedAt = parseVisitedAt(raw.visited_at);
  if (!visitedAt.ok) return fail(visitedAt.message);

  return {
    ok: true,
    value: {
      cafe_id: raw.cafe_id,
      scores,
      min_spend: minSpend,
      max_stay: maxStay,
      note,
      photos,
      visited_at: visitedAt.value,
    },
  };
}

const CAFE_EXISTS_SQL = "select id from cafes where id = $1";

const INSERT_CHECKIN_SQL = `
insert into checkins (cafe_id, user_id, is_creation, scores, min_spend, max_stay, note, photos, visited_at)
values ($1, $2, false, $3, $4, $5, $6, $7, coalesce($8, now()))
returning id
`;

/**
 * Append check-in photos to cafes.gallery with provenance (spec 0001:
 * photos auto-merge, no curator approval at MVP; `source` lets gallery
 * queries hide photos from soft-deleted check-ins). Exported together with
 * `galleryPhotosWithSource` so the creation flow merges identically.
 */
export const MERGE_GALLERY_SQL = `
update cafes
set gallery = coalesce(gallery, '[]'::jsonb) || $2::jsonb
where id = $1
`;

/** Serialize photos with `source={type:"checkin",id}` for MERGE_GALLERY_SQL. */
export function galleryPhotosWithSource(photos: StoredImage[], checkinId: string): string {
  return JSON.stringify(
    photos.map((p) => ({ ...p, source: { type: "checkin" as const, id: checkinId } })),
  );
}

/**
 * Create a regular (non-creation) check-in and refresh work_stats — all in
 * ONE transaction (the stats update is injected into the same connection;
 * a second transaction would self-deadlock on the cafe row's lock).
 * Photos auto-merge into cafes.gallery in the same transaction (spec 0001).
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
): Promise<{ checkinId: string }> {
  if (!isValidUUID(userId)) throw new Error("Invalid user ID");
  if (!isValidUUID(input.cafe_id)) throw new Error("Invalid cafe ID");

  return withTransaction(async (client) => {
    const cafe = await client.query<{ id: string }>(CAFE_EXISTS_SQL, [input.cafe_id]);
    if (!cafe.rows[0]) throw new CafeNotFoundError(input.cafe_id);

    const res = await client.query<{ id: string }>(INSERT_CHECKIN_SQL, [
      input.cafe_id,
      userId,
      JSON.stringify(input.scores),
      input.min_spend ?? null,
      input.max_stay ?? null,
      input.note ?? null,
      JSON.stringify(input.photos ?? []),
      input.visited_at ?? null,
    ]);
    const checkinId = res.rows[0]?.id;
    if (!checkinId) throw new Error("check-in insert returned no id");

    if (input.photos && input.photos.length > 0) {
      await client.query(MERGE_GALLERY_SQL, [
        input.cafe_id,
        galleryPhotosWithSource(input.photos, checkinId),
      ]);
    }

    const inSameTx: RunInTransaction = (fn) =>
      fn(<T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
        client.query<T>(text, params),
      );
    await recomputeWorkStats(input.cafe_id, 0, inSameTx);

    return { checkinId };
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
 * `{ liked: false, likesCount }` when it was removed. Throws
 * `CheckInNotFoundError` if the check-in does not exist or is soft-deleted.
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
      throw new CheckInNotFoundError();
    }

    return {
      liked: row.inserted_count > 0,
      likesCount: row.likes_count,
    };
  });
}
