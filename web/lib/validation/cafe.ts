import { isValidWeeklyHours, type WeeklyHours } from "@/lib/hours";
import {
  MAX_STAY_VALUES,
  type CheckInScores,
  type MaxStay,
} from "@/types/checkins";
import {
  fail,
  MAX_NOTE_LENGTH,
  parsePhotoIds,
  parseScores,
  parseVisitedAt,
  type ParseResult,
} from "./checkin";

/** Thrown when a cafe with the same external POI id already exists. */
export class CafeExistsError extends Error {
  constructor(readonly existingCafeId: string | null) {
    super("cafe already exists");
    this.name = "CafeExistsError";
  }
}

/** Thrown when a non-creator attempts to delete a cafe (DG125). */
export class CafeForbiddenError extends Error {
  constructor(message = "only creator can delete cafe") {
    super(message);
    this.name = "CafeForbiddenError";
  }
}

/** Thrown when a cafe has other users' live checkins and confirm is not true (DG125). */
export class CafeHasOtherCheckinsError extends Error {
  constructor(readonly n: number) {
    super("cafe has other checkins");
    this.name = "CafeHasOtherCheckinsError";
  }
}

/**
 * The creator's first check-in. Spec 0001 pins required-on-creation:
 * overall slider, max_stay, review note, >=1 photo (the
 * differentiating data); dimension sliders and visited_at stay optional.
 * Photos are plain image UUIDs (`photo_ids`) — the server provisions them
 * via upload intents and derives StoredImage (issue #86).
 */
export interface CreateCafeCheckInInput {
  scores: CheckInScores & { overall: number };
  max_stay: MaxStay;
  note: string;
  photo_ids: string[];
  visited_at?: Date;
}

/** Creation is fused with the creator's first check-in (spec 0001). */
export interface CreateCafeInput {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  google_place_id?: string;
  apple_poi_id?: string;
  opening_hours?: WeeklyHours;
  price_range?: number;
  checkin: CreateCafeCheckInInput;
}

function optString(
  value: unknown,
  field: string,
  maxLength?: number,
): ParseResult<string | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") return fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (maxLength !== undefined && trimmed.length > maxLength) {
    return fail(`${field} is too long (max ${maxLength})`);
  }
  return { ok: true, value: trimmed === "" ? undefined : trimmed };
}

/** Validate the POST /api/cafes body into a typed create input. */
export function parseCreateCafeBody(body: unknown): ParseResult<CreateCafeInput> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail("object body required");
  }
  const raw = body as Record<string, unknown>;

  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    return fail("name (non-empty string) required");
  }
  const name = raw.name.trim();
  if (name.length > 200) return fail("name is too long (max 200)");

  const lat = raw.lat;
  const lng = raw.lng;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return fail("lat must be a number between -90 and 90");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return fail("lng must be a number between -180 and 180");
  }

  const address = optString(raw.address, "address", 300);
  if (!address.ok) return fail(address.message);
  const city = optString(raw.city, "city", 100);
  if (!city.ok) return fail(city.message);
  // Provider references are opaque and can exceed the old 128-char guess
  // (Apple MapKit ids); 1024 keeps them unbounded-in-practice, bounded-in-fact.
  const googlePlaceId = optString(raw.google_place_id, "google_place_id", 1024);
  if (!googlePlaceId.ok) return fail(googlePlaceId.message);
  const applePoiId = optString(raw.apple_poi_id, "apple_poi_id", 1024);
  if (!applePoiId.ok) return fail(applePoiId.message);

  const priceRange = raw.price_range;
  if (
    priceRange !== undefined &&
    priceRange !== null &&
    (!Number.isInteger(priceRange) || (priceRange as number) < 1 || (priceRange as number) > 4)
  ) {
    return fail("price_range must be an integer between 1 and 4");
  }

  if (
    raw.opening_hours !== undefined &&
    raw.opening_hours !== null &&
    !isValidWeeklyHours(raw.opening_hours)
  ) {
    return fail("opening_hours must be {mon:{open,close},...} with HH:MM wall-clock times");
  }

  const checkinRaw = raw.checkin;
  if (typeof checkinRaw !== "object" || checkinRaw === null || Array.isArray(checkinRaw)) {
    return fail("checkin (object) required — creation is the first check-in");
  }
  const checkinBody = checkinRaw as Record<string, unknown>;

  const scores = parseScores(checkinBody.scores, "checkin.scores");
  if (!scores.ok) return fail(scores.message);
  if (typeof scores.value.overall !== "number") {
    return fail("checkin.scores.overall is required on creation (spec 0001)");
  }

  const maxStay = checkinBody.max_stay;
  if (!(MAX_STAY_VALUES as readonly string[]).includes(maxStay as string)) {
    return fail(`checkin.max_stay is required, one of ${MAX_STAY_VALUES.join("|")} (unknown is a valid answer)`);
  }

  const note = checkinBody.note;
  if (typeof note !== "string" || note.trim() === "") {
    return fail("checkin.note (non-empty string) is required on creation (spec 0001)");
  }
  if (note.trim().length > MAX_NOTE_LENGTH) return fail(`checkin.note is too long (max ${MAX_NOTE_LENGTH})`);

  if (!Array.isArray(checkinBody.photo_ids) || checkinBody.photo_ids.length === 0) {
    return fail("checkin.photo_ids must contain at least one image UUID (spec 0001)");
  }
  const photoIds = parsePhotoIds(checkinBody.photo_ids, "checkin.photo_ids");
  if (!photoIds.ok) return fail(photoIds.message);

  const visited = parseVisitedAt(checkinBody.visited_at, "checkin.visited_at");
  if (!visited.ok) return fail(visited.message);
  const visitedAt = visited.value;

  return {
    ok: true,
    value: {
      name,
      lat,
      lng,
      address: address.value,
      city: city.value,
      google_place_id: googlePlaceId.value,
      apple_poi_id: applePoiId.value,
      // Validated by isValidWeeklyHours above — the predicate narrows
      // raw.opening_hours, so no cast is needed (weakening the guard breaks tsc).
      opening_hours: raw.opening_hours ?? undefined,
      price_range: (priceRange as number | null | undefined) ?? undefined,
      checkin: {
        // overall presence was asserted above; the cast records it in the type.
        scores: scores.value as CheckInScores & { overall: number },
        max_stay: maxStay as MaxStay,
        note: note.trim(),
        photo_ids: photoIds.value,
        visited_at: visitedAt,
      },
    },
  };
}
