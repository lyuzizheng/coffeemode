import "server-only";

import tzLookup from "tz-lookup";
import { isValidUUID } from "@shared/uuid";
import { isValidWeeklyHours, type WeeklyHours } from "@/lib/hours";
import {
  incrementalUpdateWorkStats,
  type RunInTransaction,
} from "@/lib/stats/aggregate";
import { coerceWorkStats } from "@/lib/stats/work-stats";
import type { CafeDetail, CafeSummary, PublicCafeDetail } from "@/types/cafes";
import {
  MAX_STAY_VALUES,
  MIN_SPEND_VALUES,
  type CheckInScores,
  type MaxStay,
  type MinSpend,
} from "@/types/checkins";
import {
  fail,
  MAX_NOTE_LENGTH,
  MERGE_GALLERY_SQL,
  parsePhotoIds,
  parseScores,
  parseVisitedAt,
  photosWithSource,
  type ParseResult,
} from "./checkins";
import {
  consumeProvisionedIntents,
  defaultProvisionPhotosDeps,
  provisionPhotos,
  type ProvisionPhotosDeps,
} from "@/lib/images/provision-photos";
import { query, withTransaction } from "./postgres";

/** Thrown when a cafe with the same external POI id already exists. */
export class CafeExistsError extends Error {
  constructor(readonly existingCafeId: string | null) {
    super("cafe already exists");
    this.name = "CafeExistsError";
  }
}

/**
 * The creator's first check-in. Spec 0001 pins required-on-creation:
 * overall slider, min_spend, max_stay, review note, >=1 photo (the
 * differentiating data); dimension sliders and visited_at stay optional.
 * Photos are plain image UUIDs (`photo_ids`) — the server provisions them
 * via upload intents and derives StoredImage (issue #86).
 */
export interface CreateCafeCheckInInput {
  scores: CheckInScores & { overall: number };
  min_spend: MinSpend;
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

  const minSpend = checkinBody.min_spend;
  if (!(MIN_SPEND_VALUES as readonly string[]).includes(minSpend as string)) {
    return fail(`checkin.min_spend is required, one of ${MIN_SPEND_VALUES.join("|")} (unknown is a valid answer)`);
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
      opening_hours: (raw.opening_hours as WeeklyHours | null | undefined) ?? undefined,
      price_range: (priceRange as number | null | undefined) ?? undefined,
      checkin: {
        // overall presence was asserted above; the cast records it in the type.
        scores: scores.value as CheckInScores & { overall: number },
        min_spend: minSpend as MinSpend,
        max_stay: maxStay as MaxStay,
        note: note.trim(),
        photo_ids: photoIds.value,
        visited_at: visitedAt,
      },
    },
  };
}

const INSERT_CAFE_SQL = `
insert into cafes (name, location, address, city, tz, opening_hours, price_range,
                   google_place_id, apple_poi_id, created_by)
values ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4, $5, $6, $7, $8, $9, $10, $11)
returning id
`;

const INSERT_FIRST_CHECKIN_SQL = `
insert into checkins (cafe_id, user_id, is_creation, scores, min_spend, max_stay, note, photos, visited_at)
values ($1, $2, true, $3, $4, $5, $6, $7, coalesce($8, now()))
returning id
`;

/** Photos are written after the insert: their `source` needs the check-in id. */
const SET_FIRST_CHECKIN_PHOTOS_SQL = `update checkins set photos = $2::jsonb where id = $1`;

const FIND_BY_EXTERNAL_ID_SQL = `
select id from cafes
where (google_place_id is not null and google_place_id = $1)
   or (apple_poi_id is not null and apple_poi_id = $2)
limit 1
`;

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/**
 * Create a cafe fused with the creator's first check-in (spec 0001:
 * "creation is the first one") and fold the new signal into work_stats —
 * all in ONE transaction. The stats update is injected into the same
 * connection (opening a second transaction here would self-deadlock on the
 * new cafe row's lock).
 *
 * `tz` is derived from coordinates at write time (issue #77's deferred
 * population, landing with this first write path).
 *
 * Photos arrive as `photo_ids` and are provisioned (intent pre-check +
 * sharp processing) BEFORE the transaction, then consumed inside it
 * (issue #86) — the client cannot set `by`, keys, or dimensions.
 *
 * Dedupe: external POI ids are pre-checked inside the transaction (fast
 * path). A lost race still hits the unique index — but a Postgres error
 * aborts the whole transaction, so that lookup must run AFTER rollback on
 * the pool (querying the aborted connection would fail with 25P02).
 */
export async function createCafeWithFirstCheckIn(
  userId: string,
  input: CreateCafeInput,
  deps: ProvisionPhotosDeps = defaultProvisionPhotosDeps(),
): Promise<{ cafeId: string; checkinId: string; tz: string }> {
  if (!isValidUUID(userId)) throw new Error("Invalid user ID");

  const tz = tzLookup(input.lat, input.lng);
  const externalIds = [input.google_place_id ?? null, input.apple_poi_id ?? null];

  // Fail fast on a duplicate external id BEFORE provisioning (sharp work
  // would be wasted on a 409). The in-transaction pre-check + unique index
  // stay the authoritative gate against races.
  if (externalIds[0] !== null || externalIds[1] !== null) {
    const existing = await query<{ id: string } & Record<string, unknown>>(
      FIND_BY_EXTERNAL_ID_SQL,
      externalIds,
    );
    const existingId = existing.rows[0]?.id;
    if (existingId) throw new CafeExistsError(existingId);
  }

  // Pre-check intents + sharp processing BEFORE the transaction (issue #86):
  // slow I/O must not hold a DB connection. If the dedupe below loses a
  // race, the intents stay unconsumed and the user can retry against the
  // existing cafe.
  const photoIds = input.checkin.photo_ids;
  const provisioned = await provisionPhotos(userId, photoIds, deps);

  try {
    return await withTransaction(async (client) => {
      if (externalIds[0] !== null || externalIds[1] !== null) {
        const existing = await client.query<{ id: string }>(
          FIND_BY_EXTERNAL_ID_SQL,
          externalIds,
        );
        const existingId = existing.rows[0]?.id;
        if (existingId) throw new CafeExistsError(existingId);
      }

      const cafeRes = await client.query<{ id: string }>(INSERT_CAFE_SQL, [
        input.name,
        input.lat,
        input.lng,
        input.address ?? null,
        input.city ?? null,
        tz,
        input.opening_hours ? JSON.stringify(input.opening_hours) : null,
        input.price_range ?? null,
        externalIds[0],
        externalIds[1],
        userId,
      ]);
      const cafeId = cafeRes.rows[0]?.id;
      if (!cafeId) throw new Error("cafe insert returned no id");

      const checkinRes = await client.query<{ id: string }>(INSERT_FIRST_CHECKIN_SQL, [
        cafeId,
        userId,
        JSON.stringify(input.checkin.scores),
        input.checkin.min_spend,
        input.checkin.max_stay,
        input.checkin.note,
        JSON.stringify([]),
        input.checkin.visited_at ?? null,
      ]);
      const checkinId = checkinRes.rows[0]?.id;
      if (!checkinId) throw new Error("check-in insert returned no id");

      // Single-use consume inside the tx: a replay/foreign id aborts the
      // whole creation (issue #86).
      const q = client.query.bind(client) as Parameters<typeof consumeProvisionedIntents>[2];
      await consumeProvisionedIntents(userId, photoIds, q, deps);

      // The first check-in's photos auto-merge into the gallery too (spec 0001).
      const photos = photosWithSource(provisioned, checkinId);
      // $1 = checkin id, $2 = photos JSON (the SET clause's $2::jsonb).
      await client.query(SET_FIRST_CHECKIN_PHOTOS_SQL, [checkinId, JSON.stringify(photos)]);
      await client.query(MERGE_GALLERY_SQL, [cafeId, JSON.stringify(photos)]);

      const inSameTx: RunInTransaction = (fn) =>
        fn(<T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
          client.query<T>(text, params),
        );
      await incrementalUpdateWorkStats(cafeId, userId, undefined, 0, inSameTx);

      return { cafeId, checkinId, tz };
    });
  } catch (err) {
    if (err instanceof CafeExistsError) throw err;
    if (isUniqueViolation(err)) {
      // Concurrent create won the race; the transaction has rolled back
      // here, so the pool is safe to query for the winner's id.
      const { rows } = await query<{ id: string } & Record<string, unknown>>(
        FIND_BY_EXTERNAL_ID_SQL,
        externalIds,
      );
      throw new CafeExistsError(rows[0]?.id ?? null);
    }
    throw err;
  }
}

export interface NearbyCafesQuery {
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
}

const LIST_NEARBY_SQL = `
select id, slug, name,
       ST_Y(location::geometry) as lat,
       ST_X(location::geometry) as lng,
       address, city, tz, opening_hours, price_range, work_stats, cover,
       (location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
from cafes
where deleted_at is null
  and ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3::float8 * 1000)
order by distance_m asc
limit $4
`;

/** Nearby cafes within `radiusKm` of a point, closest first. */
export async function listCafesNearby(params: NearbyCafesQuery): Promise<CafeSummary[]> {
  const { rows } = await query<CafeSummary & { distance_m: number } & Record<string, unknown>>(
    LIST_NEARBY_SQL,
    [params.lat, params.lng, params.radiusKm, params.limit],
  );
  // DB default '{}' is not a full WorkStats — normalize before it reaches the UI.
  return rows.map((row) => ({ ...row, work_stats: coerceWorkStats(row.work_stats) }));
}

const GET_BY_ID_SQL = `
select id, slug, name,
       ST_Y(location::geometry) as lat,
       ST_X(location::geometry) as lng,
       address, city, description, cover, gallery, opening_hours, tz,
       price_range, google_place_id, apple_poi_id, work_stats,
       created_at, updated_at
from cafes
where id = $1 and deleted_at is null
`;

/** Single cafe by id; null when missing or soft-deleted (routes map this to 404). */
export async function getCafe(id: string): Promise<CafeDetail | null> {
  if (!isValidUUID(id)) throw new Error("Invalid cafe ID");
  const { rows } = await query<CafeDetail & Record<string, unknown>>(GET_BY_ID_SQL, [id]);
  const row = rows[0];
  if (!row) return null;
  return { ...row, work_stats: coerceWorkStats(row.work_stats) };
}

/**
 * Public cafe detail projection (spec 0001 DG13): strip `StoredImage.by`
 * from gallery so the anonymous surface never leaks internal author ids.
 * Mirrors `web/lib/discovery/feed.ts:159` which does the same for check-in photos.
 */
export function toPublicCafeDetail(cafe: CafeDetail): PublicCafeDetail {
  return {
    ...cafe,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip internal author id (DG13)
    gallery: (cafe.gallery ?? []).map(({ by: _by, ...image }) => image),
  };
}

export interface CafeSitemapEntry {
  id: string;
  /** ISO timestamp. */
  lastmod: string;
}

const LIST_SITEMAP_SQL = `
select id,
       coalesce((work_stats->>'updated_at')::timestamptz, updated_at) as lastmod
from cafes
where deleted_at is null
order by lastmod desc
`;

/**
 * All live cafes for sitemap.xml. lastmod prefers work_stats.updated_at per
 * DG105 (the aggregate is what actually changes when check-ins land) and
 * falls back to the row's updated_at for cafes whose stats predate the field.
 */
export async function listCafeSitemapEntries(): Promise<CafeSitemapEntry[]> {
  const { rows } = await query<{ id: string; lastmod: Date } & Record<string, unknown>>(
    LIST_SITEMAP_SQL,
  );
  return rows.map((row) => ({
    id: row.id,
    lastmod: new Date(row.lastmod).toISOString(),
  }));
}

const GET_LOCATION_SQL = `
select ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
from cafes
where id = $1
`;

const EXISTS_SQL = `select 1 from cafes where id = $1 and deleted_at is null`;

/**
 * Existence probe for the gone-cafe 404 path: the proxy checks this BEFORE
 * the page streams so a missing cafe gets a real 404 status (DG19) instead
 * of a streamed soft-404. PK index lookup only — never fetch content here.
 */
export async function cafeExists(id: string): Promise<boolean> {
  if (!isValidUUID(id)) return false;
  const { rows } = await query<Record<string, unknown>>(EXISTS_SQL, [id]);
  return rows.length > 0;
}

/**
 * Soft delete a cafe by id (issue #207). Retains the row and coordinates
 * as a location tombstone for 404 recovery suggestions.
 */
export async function softDeleteCafe(id: string): Promise<boolean> {
  if (!isValidUUID(id)) return false;
  const result = await query(
    `update cafes set deleted_at = now() where id = $1 and deleted_at is null`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * A cafe's coordinates when the row still exists (including soft-deleted cafes).
 * Unlike getCafe this tolerates invalid ids (returns null) because its caller is the 404
 * recovery path (DG111), where a malformed id is a normal case. The kept tombstone row
 * allows recovery suggestions to find nearby alternatives.
 */
export async function getCafeLocation(
  id: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!isValidUUID(id)) return null;
  const { rows } = await query<{ lat: number; lng: number } & Record<string, unknown>>(
    GET_LOCATION_SQL,
    [id],
  );
  const row = rows[0];
  return row ? { lat: row.lat, lng: row.lng } : null;
}
