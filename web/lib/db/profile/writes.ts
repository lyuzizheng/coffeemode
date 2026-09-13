import "server-only";

import { isValidUUID } from "@shared/uuid";
import { query } from "../postgres";
import { appConfig } from "@/lib/config";
import { DEFAULT_CITY } from "@/lib/cities";
import { LAST_LOCATION_SQL, toProfileDto, type ProfileRow } from "./row";
import { getProfile } from "./reads";
import type { UserProfileDto } from "./types";

export interface ProfilePatchInput {
  displayName?: string;
  currentCity?: string;
  onboarded?: boolean;
  lastLocation?: { lat: number; lng: number };
}

/** Build the SET clause + params for the fields present in the patch.
 * Params are numbered $2.. (userId occupies $1 in the UPDATE). */
function buildUpdates(patch: ProfilePatchInput): { updates: string[]; params: unknown[] } {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (patch.displayName !== undefined) {
    const trimmed = patch.displayName.trim();
    if (trimmed.length > 0 && trimmed.length <= appConfig.profile.displayNameMaxChars) {
      params.push(trimmed);
      updates.push(`display_name = $${params.length + 1}`);
    }
  }

  if (patch.currentCity !== undefined) {
    const trimmedCity = patch.currentCity.trim().toLowerCase();
    if (trimmedCity.length > 0 && trimmedCity.length <= appConfig.validation.profileCityMaxChars) {
      params.push(trimmedCity);
      updates.push(`current_city = $${params.length + 1}`);
    }
  }

  if (patch.onboarded !== undefined) {
    params.push(patch.onboarded);
    updates.push(`onboarded = $${params.length + 1}`);
  }

  if (patch.lastLocation !== undefined) {
    params.push(patch.lastLocation.lng, patch.lastLocation.lat);
    updates.push(
      `last_location = ST_SetSRID(ST_MakePoint($${params.length}, $${params.length + 1}), 4326)::geography`,
    );
  }

  return { updates, params };
}

/** Update user profile display name, current city, or onboarding state. */
export async function updateProfile(
  userId: string,
  patch: ProfilePatchInput,
): Promise<UserProfileDto | null> {
  if (!isValidUUID(userId)) return null;

  const { updates, params: fieldParams } = buildUpdates(patch);
  if (updates.length === 0) {
    return getProfile(userId);
  }

  const params: unknown[] = [userId, ...fieldParams, DEFAULT_CITY.id];
  const defaultCityParamIdx = params.length;

  const result = await query<ProfileRow>(
    `
    update profiles
    set ${updates.join(", ")}, last_seen_at = now()
    where id = $1
    returning id, display_name, avatar_url, coalesce(current_city, $${defaultCityParamIdx}) as current_city,
              ${LAST_LOCATION_SQL},
              onboarded, created_at,
              show_public_identity, public_handle, identity_consented_at, public_handle_changed_at
    `,
    params,
  );

  if (result.rows.length === 0) return null;
  return toProfileDto(result.rows[0]);
}
