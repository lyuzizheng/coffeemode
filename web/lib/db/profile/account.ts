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
 * lock instead of deadlocking in opposite order. The two locking SELECTs
 * name ORDER BY so concurrent deleteAccount transactions acquire in the
 * same sequence; the follow-up UPDATEs target only rows already held by
 * those SELECTs, so they acquire no new contended locks.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  if (!isValidUUID(userId)) {
    throw new Error("invalid user id");
  }

  return withTransaction(async (client) => {
    // Lock every affected cafe row (created cafes + cafes holding live
    // check-ins) before any check-in row: deleteCafe / softDeleteCheckIn /
    // updateCheckIn take the same cafe → checkin order, so a concurrent
    // deleteAccount + deleteCafe (or check-in edit/delete) on the same cafe
    // serializes on the cafe lock instead of deadlocking in opposite order.
    // ORDER BY keeps acquisition deterministic across statements.
    await client.query(
      `select c.id from cafes c
       where c.created_by = $1
          or exists (select 1 from checkins ci
                     where ci.cafe_id = c.id and ci.user_id = $1 and ci.deleted_at is null)
       order by c.id for update`,
      [userId],
    );
    // Live check-ins grouped by cafe — the gallery purge and stats
    // recompute run once per affected cafe, not once per row.
    const checkinsRes = await client.query<{ id: string; cafe_id: string }>(
      `select id, cafe_id from checkins where user_id = $1 and deleted_at is null
       order by cafe_id, id for update`,
      [userId],
    );
    const byCafe = new Map<string, string[]>();
    for (const row of checkinsRes.rows) {
      const list = byCafe.get(row.cafe_id) ?? [];
      list.push(row.id);
      byCafe.set(row.cafe_id, list);
    }

    if (checkinsRes.rows.length > 0) {
      await client.query(
        `update checkins set deleted_at = now(), updated_at = now()
         where user_id = $1 and deleted_at is null`,
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
    // checkins.user_id has no ON DELETE clause — detach the tombstones so
    // the FK doesn't block the profile delete. Rows stay (DG146 audit
    // trail); only the author link goes.
    await client.query(`update checkins set user_id = null where user_id = $1`, [userId]);
    await client.query(`delete from profiles where id = $1`, [userId]);

    return {
      ok: true,
      checkins_removed: checkinsRes.rows.length,
      cafes_transferred: transferred.rowCount ?? 0,
    };
  });
}
