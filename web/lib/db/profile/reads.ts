import "server-only";

import { isValidUUID } from "@shared/uuid";
import { query } from "../postgres";
import { DEFAULT_CITY } from "@/lib/cities";
import { mapIdentityFields, type ProfileIdentityRow } from "./identity";
import type { UserProfileDto, UserProfileStatsDto } from "./types";

/** Get the profile record for a user. */
export async function getProfile(userId: string): Promise<UserProfileDto | null> {
  if (!isValidUUID(userId)) return null;

  const result = await query<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    current_city: string;
    created_at: Date;
  } & ProfileIdentityRow>(
    `
    select id, display_name, avatar_url, coalesce(current_city, $2) as current_city, created_at,
           show_public_identity, public_handle, identity_consented_at, public_handle_changed_at
    from profiles
    where id = $1
    `,
    [userId, DEFAULT_CITY.id],
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    currentCity: row.current_city,
    createdAt: row.created_at.toISOString(),
    ...mapIdentityFields(row),
  };
}

/** Get user's distinct cafe count and total check-in count. */
export async function getUserStats(userId: string): Promise<UserProfileStatsDto> {
  if (!isValidUUID(userId)) {
    return { cafesCount: 0, checkinsCount: 0 };
  }

  const result = await query<{
    cafes_count: string | number;
    checkins_count: string | number;
  }>(
    `
    select
      count(distinct ch.cafe_id) filter (where ch.deleted_at is null and c.deleted_at is null) as cafes_count,
      count(ch.id) filter (where ch.deleted_at is null) as checkins_count
    from checkins ch
    left join cafes c on c.id = ch.cafe_id
    where ch.user_id = $1
    `,
    [userId],
  );

  const row = result.rows[0];
  return {
    cafesCount: Number(row?.cafes_count ?? 0),
    checkinsCount: Number(row?.checkins_count ?? 0),
  };
}
