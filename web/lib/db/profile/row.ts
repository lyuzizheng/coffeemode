import "server-only";

import { mapIdentityFields, type ProfileIdentityRow } from "./identity";
import type { UserProfileDto } from "./types";

/**
 * Shared profile row projection (spec 0009 §5 — the SELECT column list and
 * row→DTO mapping must exist once; getProfile and updateProfile's RETURNING
 * clause both consume it).
 */

export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  current_city: string;
  current_city_name: string | null;
  last_location: { x: number; y: number } | null;
  onboarded: boolean;
  created_at: Date;
} & ProfileIdentityRow;

/** PostGIS geography → JSON: ST_X is longitude, ST_Y latitude. */
export const LAST_LOCATION_SQL = `case when last_location is null then null
     else json_build_object('x', ST_X(last_location::geometry),
                            'y', ST_Y(last_location::geometry))
end as last_location`;

export function toProfileDto(row: ProfileRow): UserProfileDto {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    currentCity: row.current_city,
    currentCityName: row.current_city_name,
    lastLocation: row.last_location
      ? { lat: row.last_location.y, lng: row.last_location.x }
      : null,
    onboarded: row.onboarded,
    createdAt: row.created_at.toISOString(),
    ...mapIdentityFields(row),
  };
}
