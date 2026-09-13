import "server-only";

import { isValidUUID } from "@shared/uuid";
import { query } from "../postgres";
import { appConfig } from "@/lib/config";
import { DEFAULT_CITY } from "@/lib/cities";
import { mapIdentityFields, type ProfileIdentityRow } from "./identity";
import { getProfile } from "./reads";
import type { UserProfileDto } from "./types";

/** Update user profile display name or current city. */
export async function updateProfile(
  userId: string,
  patch: { displayName?: string; currentCity?: string },
): Promise<UserProfileDto | null> {
  if (!isValidUUID(userId)) return null;

  const updates: string[] = [];
  const params: unknown[] = [userId];

  if (patch.displayName !== undefined) {
    const trimmed = patch.displayName.trim();
    if (trimmed.length > 0 && trimmed.length <= appConfig.profile.displayNameMaxChars) {
      params.push(trimmed);
      updates.push(`display_name = $${params.length}`);
    }
  }

  if (patch.currentCity !== undefined) {
    const trimmedCity = patch.currentCity.trim().toLowerCase();
    if (trimmedCity.length > 0 && trimmedCity.length <= appConfig.validation.profileCityMaxChars) {
      params.push(trimmedCity);
      updates.push(`current_city = $${params.length}`);
    }
  }

  if (updates.length === 0) {
    return getProfile(userId);
  }

  params.push(DEFAULT_CITY.id);
  const defaultCityParamIdx = params.length;

  const result = await query<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    current_city: string;
    created_at: Date;
  } & ProfileIdentityRow>(
    `
    update profiles
    set ${updates.join(", ")}, last_seen_at = now()
    where id = $1
    returning id, display_name, avatar_url, coalesce(current_city, $${defaultCityParamIdx}) as current_city, created_at,
              show_public_identity, public_handle, identity_consented_at, public_handle_changed_at
    `,
    params,
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
