import "server-only";

import { isValidUUID } from "@shared/uuid";
import { incrementalUpdateWorkStats } from "@/lib/stats/aggregate";
import {
  CafeExistsError,
  type CreateCafeInput,
} from "@/lib/validation/cafe";
import {
  consumeProvisionedIntents,
  defaultProvisionPhotosDeps,
  provisionPhotos,
  type ProvisionPhotosDeps,
} from "@/lib/images/provision-photos";
import { MERGE_GALLERY_SQL, photosWithSource } from "../checkins/gallery";
import { query, txQueryFrom, txRunnerFrom, withTransaction } from "../postgres";
import { resolveCafeTimezone } from "./meta";

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
      const q = txQueryFrom(client);
      await consumeProvisionedIntents(userId, photoIds, q, deps);

      // The first check-in's photos auto-merge into the gallery too (spec 0001).
      const photos = photosWithSource(provisioned, checkinId);
      // $1 = checkin id, $2 = photos JSON (the SET clause's $2::jsonb).
      await client.query(SET_FIRST_CHECKIN_PHOTOS_SQL, [checkinId, JSON.stringify(photos)]);
      await client.query(MERGE_GALLERY_SQL, [cafeId, JSON.stringify(photos)]);

      await incrementalUpdateWorkStats(cafeId, userId, undefined, 0, txRunnerFrom(client));

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
