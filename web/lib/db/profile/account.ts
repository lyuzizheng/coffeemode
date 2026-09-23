import "server-only";

import { isValidUUID } from "@shared/uuid";
import { recomputeWorkStats } from "@/lib/stats/aggregate";
import { getServiceAccountId } from "@/lib/db/cafes/meta";
import { query, txRunnerFrom, withTransaction } from "../postgres";
import { LAST_LOCATION_SQL, toProfileDto, type ProfileRow } from "./row";
import type { UserProfileDto } from "./types";

/**
 * Account-level data operations (BRAWUKA-504): the export bundle behind
 * GET /api/profile/export and the permanent teardown behind
 * DELETE /api/profile.
 *
 * Deletion policy (spec 0004 DG149): check-ins soft-delete (DG146
 * semantics — work_stats recomputes, gallery entries the user sourced are
 * pulled), cafes they created hand off to the service account (orphan
 * shell semantics), likes/navigations/upload intents/profile row hard
 * delete. The Supabase auth user is removed separately by the route when
 * the service-role key is configured.
 */

export interface ProfileExportBundle {
  exported_at: string;
  profile: UserProfileDto | null;
  checkins: unknown[];
  cafes_created: unknown[];
  navigations: unknown[];
  checkin_likes: unknown[];
  image_upload_intents: unknown[];
}

/** Everything the account owns, in one JSON bundle. Check-ins include
 * soft-deleted rows (deleted_at carried) — an export is the user's data,
 * not the public view of it. */
export async function getProfileExport(userId: string): Promise<ProfileExportBundle> {
  const profileRes = await query<ProfileRow>(
    `select id, display_name, avatar_url, coalesce(current_city, 'singapore') as current_city,
            ${LAST_LOCATION_SQL}, onboarded, created_at,
            show_public_identity, public_handle, identity_consented_at, public_handle_changed_at
     from profiles where id = $1`,
    [userId],
  );

  const checkins = await query(
    `select id, cafe_id, visited_at, scores, max_stay, note, photos,
            is_creation, likes_count, created_at, updated_at, deleted_at
     from checkins where user_id = $1 order by visited_at desc`,
    [userId],
  );

  const cafesCreated = await query(
    `select id, name, city, address,
            ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
            visibility, created_at
     from cafes where created_by = $1 order by created_at desc`,
    [userId],
  );
  const navigations = await query(
    `select id, cafe_id, resolved, outcome, ask_count, last_asked_at, created_at
     from navigations where user_id = $1 order by created_at desc`,
    [userId],
  );

  const checkinLikes = await query(
    `select id, checkin_id, created_at
     from checkin_likes where user_id = $1 order by created_at desc`,
    [userId],
  );

  // Pending upload intents (single-use rows from POST /api/images/upload
  // not yet consumed by /api/images/complete): deleteAccount wipes them,
  // so the export must carry them or the user loses data they own.
  const imageUploadIntents = await query(
    `select image_uuid, created_at
     from image_upload_intents where user_id = $1 order by created_at desc`,
    [userId],
  );

  return {
    exported_at: new Date().toISOString(),
    profile: profileRes.rows[0] ? toProfileDto(profileRes.rows[0]) : null,
    checkins: checkins.rows,
    cafes_created: cafesCreated.rows,
    navigations: navigations.rows,
    checkin_likes: checkinLikes.rows,
    image_upload_intents: imageUploadIntents.rows,
  };
}

export interface DeleteAccountResult {
  ok: true;
  checkins_removed: number;
  cafes_transferred: number;
}

/**
 * Lock-order contract (BRAWUKA-574): every multi-row writer takes cafe-row
 * locks before check-in-row locks — cafe id ascending, then check-in id
 * ascending. deleteCafe locks cafe → caller check-ins, softDeleteCheckIn /
 * updateCheckIn lock the check-in's cafe → the check-in; this function does
 * the same (cafes first, then check-ins), so concurrent deleteAccount +
 * deleteCafe / softDeleteCheckIn on the same cafe serialize on the cafe
 * lock instead of deadlocking in opposite order.
 *
 * BRAWUKA-601: the cafe set and the live check-in set are read in ONE
 * statement — a single READ COMMITTED snapshot. Two separate locking
 * SELECTs each took a fresh snapshot, so a check-in committed between
 * them entered the check-in set while its cafe stayed unlocked; the
 * gallery purge then took that cafe's lock after the check-in lock —
 * checkin → cafe, the inverse order, i.e. a 40P01 cycle against a
 * concurrent softDeleteCheckIn / updateCheckIn.
 *
 * FOR UPDATE OF c names only the cafe side — Postgres rejects FOR UPDATE
 * on the nullable side of a LEFT JOIN, and it isn't needed: the blanket
 * UPDATE in deleteAccount is the first statement to touch check-in rows,
 * so every check-in lock is still taken strictly after every cafe lock.
 * ORDER BY keeps cafe acquisition deterministic across concurrent
 * deleteAccount runs.
 */
const LOCK_ACCOUNT_SCOPE_SQL = `
select c.id as cafe_id, ci.id as checkin_id
from cafes c
left join checkins ci
  on ci.cafe_id = c.id and ci.user_id = $1 and ci.deleted_at is null
where c.created_by = $1 or ci.id is not null
order by c.id, ci.id
for update of c
`;
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  if (!isValidUUID(userId)) {
    throw new Error("invalid user id");
  }

  return withTransaction(async (client) => {
    const lockRes = await client.query<{ cafe_id: string; checkin_id: string | null }>(
      LOCK_ACCOUNT_SCOPE_SQL,
      [userId],
    );
    // Live check-ins grouped by cafe — the gallery purge and stats
    // recompute run once per affected cafe, not once per row.
    const byCafe = new Map<string, string[]>();
    let checkinsRemoved = 0;
    for (const row of lockRes.rows) {
      if (row.checkin_id === null) continue;
      const list = byCafe.get(row.cafe_id) ?? [];
      list.push(row.checkin_id);
      byCafe.set(row.cafe_id, list);
      checkinsRemoved += 1;
    }

    // Soft-delete + detach in one statement (DG146 tombstones stay; only
    // the author link goes — checkins.user_id has no ON DELETE clause, so
    // the detach must land before the profile delete). The blanket
    // predicate also catches check-ins committed after the lock snapshot:
    // they are tombstoned and detached here instead of escaping as live
    // orphans or tripping the profile-delete FK. Their cafes are not in
    // byCafe, so the purge below never takes a cafe lock after a check-in
    // lock — the inversion stays closed. Residual: such a check-in's
    // gallery entries on a cafe outside the lock set are not purged.
    await client.query(
      `update checkins
       set deleted_at = coalesce(deleted_at, now()),
           user_id = null,
           updated_at = now()
       where user_id = $1`,
      [userId],
    );

    for (const [cafeId, checkinIds] of byCafe) {
      await client.query(
        `update cafes set gallery = coalesce(
           (select jsonb_agg(elem) from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) elem
            where elem->'source'->>'id' is null or not (elem->'source'->>'id' = any($2::text[]))), '[]'::jsonb),
           updated_at = now()
         where id = $1`,
        [cafeId, checkinIds],
      );
      await recomputeWorkStats(cafeId, 0, txRunnerFrom(client));
    }

    // Cafes the user created survive as orphan shells (DG146): ownership
    // moves to the service account so the profile row can go.
    const serviceAccountId = getServiceAccountId();
    const transferred = await client.query(
      `update cafes set created_by = $2, updated_at = now()
       where created_by = $1`,
      [userId, serviceAccountId],
    );

    await client.query(`delete from checkin_likes where user_id = $1`, [userId]);
    await client.query(`delete from navigations where user_id = $1`, [userId]);
    await client.query(`delete from image_upload_intents where user_id = $1`, [userId]);
    await client.query(`delete from profiles where id = $1`, [userId]);

    return {
      ok: true,
      checkins_removed: checkinsRemoved,
      cafes_transferred: transferred.rowCount ?? 0,
    };
  });
}
