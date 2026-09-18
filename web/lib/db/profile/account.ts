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
    `select id, cafe_id, visited_at, scores, max_stay, notes, photos,
            is_creation, likes_count, created_at, updated_at, deleted_at
     from checkins where user_id = $1 order by visited_at desc`,
    [userId],
  );

  const cafesCreated = await query(
    `select id, name, city, address, lat, lng, visibility, created_at
     from cafes where created_by = $1 order by created_at desc`,
    [userId],
  );

  const navigations = await query(
    `select id, cafe_id, resolved, created_at, resolved_at
     from navigations where user_id = $1 order by created_at desc`,
    [userId],
  );

  return {
    exported_at: new Date().toISOString(),
    profile: profileRes.rows[0] ? toProfileDto(profileRes.rows[0]) : null,
    checkins: checkins.rows,
    cafes_created: cafesCreated.rows,
    navigations: navigations.rows,
  };
}

export interface DeleteAccountResult {
  ok: true;
  checkins_removed: number;
  cafes_transferred: number;
}

/** Permanent account teardown. One transaction: soft-delete the user's
 * live check-ins (per-cafe gallery purge + work_stats recompute, same
 * semantics as DG146 cafe delete), hand created cafes to the service
 * account, then hard-delete likes, navigations, upload intents, and the
 * profile row itself. */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  if (!isValidUUID(userId)) {
    throw new Error("invalid user id");
  }

  return withTransaction(async (client) => {
    // Live check-ins grouped by cafe — the gallery purge and stats
    // recompute run once per affected cafe, not once per row.
    const checkinsRes = await client.query<{ id: string; cafe_id: string }>(
      `select id, cafe_id from checkins where user_id = $1 and deleted_at is null for update`,
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
    await client.query(
      `update cafes set owner_id = null where owner_id = $1`,
      [userId],
    );

    await client.query(`delete from checkin_likes where user_id = $1`, [userId]);
    await client.query(`delete from navigations where user_id = $1`, [userId]);
    await client.query(`delete from image_upload_intents where user_id = $1`, [userId]);
    await client.query(`delete from profiles where id = $1`, [userId]);

    return {
      ok: true,
      checkins_removed: checkinsRes.rows.length,
      cafes_transferred: transferred.rowCount ?? 0,
    };
  });
}
