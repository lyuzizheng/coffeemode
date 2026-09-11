import { isValidUUID } from "@shared/uuid";
import { WORK_DIMS } from "@/lib/stats/work-stats";
import {
  MAX_STAY_VALUES,
  type CheckInScores,
  type MaxStay,
} from "@/types/checkins";
import { appConfig } from "@/lib/config";

/* ------------------------------------------------------------------ *
 * Shared payload parsing — the cafes creation flow (./cafe.ts)
 * reuses these for its fused first check-in.
 * ------------------------------------------------------------------ */

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export function fail<T>(message: string): ParseResult<T> {
  return { ok: false, message };
}

/**
 * Parse the `filter_max_stay` query filter (DG44). Only the domain's
 * `MAX_STAY_VALUES` are accepted; absent or unknown labels are ignored.
 */
export function parseMaxStayFilter(value: string | null): MaxStay | undefined {
  if (!value) return undefined;
  return MAX_STAY_VALUES.includes(value as MaxStay) ? (value as MaxStay) : undefined;
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
const MAX_PHOTOS_PER_CHECKIN = appConfig.checkins.photoCap;

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

/** Thrown when a write references a cafe that does not exist. */
export class CafeNotFoundError extends Error {
  constructor(readonly cafeId: string) {
    super("cafe not found");
    this.name = "CafeNotFoundError";
  }
}

/**
 * Thrown when a regular check-in collides with the caller's live check-in
 * for the same cafe inside the revisit window (DG64: at most 1 per cafe
 * per user per `checkins.revisitWindowHours`). The caller should edit
 * `existingCheckinId` instead — the drawer does this preemptively, and the
 * POST route surfaces the id so raced clients can convert silently.
 */
export class DuplicateCheckInError extends Error {
  constructor(public existingCheckinId: string) {
    super(`duplicate check-in within the revisit window: ${existingCheckinId}`);
    this.name = "DuplicateCheckInError";
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
  /**
   * DG61 idempotency key (UUID v4, one per drawer open). The server dedupes
   * on (user_id, idempotency_key): a replay returns the original check-in
   * id instead of inserting a second row. Absent for the fused
   * cafe-creation first check-in, which has no drawer key.
   */
  idempotency_key?: string;
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

  // DG61: optional client idempotency key (UUID v4, one per drawer open).
  // Absent/null means "no dedupe" (legacy clients, fused creation flow).
  let idempotencyKey: string | undefined;
  if (raw.idempotency_key !== undefined && raw.idempotency_key !== null) {
    if (!isValidUUID(raw.idempotency_key)) return fail("idempotency_key (UUID v4 string) required");
    idempotencyKey = (raw.idempotency_key as string).toLowerCase();
  }

  return {
    ok: true,
    value: {
      cafe_id: raw.cafe_id,
      scores,
      max_stay: maxStay,
      note,
      photo_ids: photoIds,
      visited_at: visitedAt.value,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    },
  };
}

/** DG64 revisit window, hours (DG107: product value lives in app.yaml). */
export const REVISIT_WINDOW_HOURS = appConfig.checkins.revisitWindowHours;

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
