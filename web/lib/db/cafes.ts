import "server-only";

import tzLookup from "tz-lookup";
import { isValidUUID } from "@shared/uuid";
import { isValidWeeklyHours, type WeeklyHours } from "@/lib/hours";
import { findCity } from "@/lib/cities";
import {
  incrementalUpdateWorkStats,
  recomputeWorkStats,
  type RunInTransaction,
} from "@/lib/stats/aggregate";
import { coerceWorkStats } from "@/lib/stats/work-stats";
import type { CafeDetail, CafeSummary, PublicCafeDetail } from "@/types/cafes";
import type { StoredImage } from "@/types/images";
import {
  MAX_STAY_VALUES,
  type CheckInScores,
  type MaxStay,
} from "@/types/checkins";
import {
  CafeNotFoundError,
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

/**
 * Safely resolves the IANA timezone for a coordinate pair.
 * Falls back to city-based timezone lookup or "UTC" on coordinate boundary/ocean errors.
 */
export function resolveCafeTimezone(
  lat: number,
  lng: number,
  city?: string | null,
): string {
  try {
    const tz = tzLookup(lat, lng);
    if (tz) return tz;
  } catch {
    // Coordinate out of bounds (RangeError: invalid coordinates)
  }
  const fallbackTz = (city && findCity(city)?.tz) || "UTC";
  console.warn(
    `[resolveCafeTimezone] Falling back to "${fallbackTz}" for coordinates (${lat}, ${lng}) with city "${city}"`,
  );
  return fallbackTz;
}

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
export interface DeleteCafeResult {
  ok: true;
  id: string;
  removed_checkins: number;
  owner_transferred: boolean;
  shell: boolean;
}

const DEFAULT_SERVICE_ACCOUNT_ID = "00000000-0000-4000-a000-000000000001";

/** Resolves service account ID from SERVICE_ACCOUNT_ID env var with fixed UUID fallback (DG107 override). */
export function getServiceAccountId(): string {
  const envId = process.env.SERVICE_ACCOUNT_ID?.trim();
  return envId && isValidUUID(envId) ? envId : DEFAULT_SERVICE_ACCOUNT_ID;
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
      opening_hours: (raw.opening_hours as WeeklyHours | null | undefined) ?? undefined,
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

const INSERT_CAFE_SQL = `
insert into cafes (name, location, address, city, tz, opening_hours, price_range,
                   google_place_id, apple_poi_id, created_by)
values ($1, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4, $5, $6, $7, $8, $9, $10, $11)
returning id
`;

const INSERT_FIRST_CHECKIN_SQL = `
insert into checkins (cafe_id, user_id, is_creation, scores, max_stay, note, photos, visited_at)
values ($1, $2, true, $3, $4, $5, $6, coalesce($7, now()))
returning id
`;

/** Photos are written after the insert: their `source` needs the check-in id. */
const SET_FIRST_CHECKIN_PHOTOS_SQL = `update checkins set photos = $2::jsonb where id = $1`;

const FIND_BY_EXTERNAL_ID_SQL = `
select id from cafes
where ((google_place_id is not null and google_place_id = $1)
   or (apple_poi_id is not null and apple_poi_id = $2))
  and deleted_at is null
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

  const tz = resolveCafeTimezone(input.lat, input.lng, input.city);
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
select id, name,
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
select id, name,
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
  return {
    ...row,
    gallery: row.gallery ?? [],
    work_stats: coerceWorkStats(row.work_stats),
  };
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
  and coalesce((work_stats->>'n_checkins')::int, 0) > 0
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
 * Cafe deletion is checkin-scoped and never deletes the cafe row (DG125).
 * Creator-only. Inside a single FOR UPDATE transaction:
 * - Counts other users' live checkins (`user_id <> caller`).
 * - If others >= 1 and `options?.confirm !== true` -> throws CafeHasOtherCheckinsError(others).
 * - Soft-deletes all caller's live checkins, hides photos from gallery, recomputes work_stats.
 * - If others >= 1: updates `created_by` to the service account.
 * - Returns { ok: true, id, removed_checkins: k, owner_transferred: others >= 1, shell: others === 0 }.
 *
 * Idempotency:
 * - Repeat after handoff: created_by moved -> throws CafeForbiddenError (403).
 * - Repeat on own shell: 0 own live checkins -> throws CafeNotFoundError (404).
 */
export async function deleteCafe(
  cafeId: string,
  userId: string,
  options?: { confirm?: boolean },
): Promise<DeleteCafeResult> {
  if (!isValidUUID(cafeId) || !isValidUUID(userId)) {
    throw new CafeNotFoundError(cafeId);
  }

  return withTransaction(async (client) => {
    const inSameTx: RunInTransaction = (fn) =>
      fn(<T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
        client.query<T>(text, params),
      );

    const cafeRes = await client.query<{
      id: string;
      created_by: string | null;
      deleted_at: string | null;
    }>(
      `select id, created_by, deleted_at from cafes where id = $1 for update`,
      [cafeId],
    );
    const cafeRow = cafeRes.rows[0];
    if (!cafeRow || cafeRow.deleted_at !== null) {
      throw new CafeNotFoundError(cafeId);
    }

    if (cafeRow.created_by !== userId) {
      throw new CafeForbiddenError();
    }

    const othersRes = await client.query<{ count: string }>(
      `select count(*)::text from checkins where cafe_id = $1 and deleted_at is null and user_id <> $2`,
      [cafeId, userId],
    );
    const others = Number.parseInt(othersRes.rows[0]?.count ?? "0", 10);

    const callerCheckinsRes = await client.query<{ id: string }>(
      `select id from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null for update`,
      [cafeId, userId],
    );
    const callerCheckinIds = callerCheckinsRes.rows.map((r) => r.id);
    const k = callerCheckinIds.length;

    // If other users have live checkins, confirmation is required before handoff / mutation
    if (others >= 1 && !options?.confirm) {
      throw new CafeHasOtherCheckinsError(others);
    }

    // Repeat on own shell: 0 own live checkins and 0 others -> 404 nothing to delete
    if (k === 0 && others === 0) {
      throw new CafeNotFoundError(cafeId);
    }

    if (k > 0) {
      await client.query(
        `update checkins set deleted_at = now(), updated_at = now()
         where cafe_id = $1 and user_id = $2 and deleted_at is null`,
        [cafeId, userId],
      );

      await client.query(
        `update cafes set gallery = coalesce(
           (select jsonb_agg(elem) from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) elem
            where elem->'source'->>'id' is null or not (elem->'source'->>'id' = any($2::text[]))), '[]'::jsonb),
           updated_at = now()
         where id = $1`,
        [cafeId, callerCheckinIds],
      );

      await recomputeWorkStats(cafeId, 0, inSameTx);
    }

    const ownerTransferred = others >= 1;
    if (ownerTransferred) {
      const serviceAccountId = getServiceAccountId();
      await client.query(
        `update cafes set created_by = $2 where id = $1 and created_by = $3`,
        [cafeId, serviceAccountId, userId],
      );
    }

    return {
      ok: true,
      id: cafeId,
      removed_checkins: k,
      owner_transferred: ownerTransferred,
      shell: others === 0,
    };
  });
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

const OWNS_CAFE_SQL = `
select id from cafes where id = $1 and created_by = $2 and deleted_at is null
`;

export async function ownsCafe(
  cafeId: string,
  userId: string,
  q = query,
): Promise<boolean> {
  if (!isValidUUID(cafeId) || !isValidUUID(userId)) return false;
  const result = await q<{ id: string }>(OWNS_CAFE_SQL, [cafeId, userId]);
  return result.rows.length > 0;
}

const ATTACH_IMAGE_TO_CAFE_SQL = `
update cafes
set gallery = coalesce(gallery, '[]'::jsonb) || (
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
  from jsonb_array_elements($1::jsonb) elem
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) g
    where g->>'id' = elem->>'id'
  )
),
cover = case when $5::boolean then $2 else cover end
where id = $3 and created_by = $4 and deleted_at is null
returning id
`;

export async function attachImageToCafe(
  params: {
    cafeId: string;
    userId: string;
    image: StoredImage;
    isCover?: boolean;
  },
  q = query,
): Promise<boolean> {
  const coverKey = params.isCover ? params.image.card : null;
  const result = await q<{ id: string }>(ATTACH_IMAGE_TO_CAFE_SQL, [
    JSON.stringify([params.image]),
    coverKey,
    params.cafeId,
    params.userId,
    params.isCover ?? false,
  ]);
  return (result.rowCount ?? result.rows.length) > 0;
}
