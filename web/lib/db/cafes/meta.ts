import "server-only";

import tzLookup from "tz-lookup";
import { isValidUUID } from "@shared/uuid";
import { findCity } from "@/lib/cities";

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

const DEFAULT_SERVICE_ACCOUNT_ID = "00000000-0000-4000-a000-000000000001";

/** Resolves service account ID from SERVICE_ACCOUNT_ID env var with fixed UUID fallback (DG107 override). */
export function getServiceAccountId(): string {
  const envId = process.env.SERVICE_ACCOUNT_ID?.trim();
  return envId && isValidUUID(envId) ? envId : DEFAULT_SERVICE_ACCOUNT_ID;
}

/**
 * True when the cafe is attributed to the CoffeeMode service account — a
 * community-imported or handed-off cafe with no human owner. Null/undefined
 * `created_by` falls back to the service account (DG107 / DG146 handoff).
 *
 * Returns a decidable marker, never copy: the user-visible maintainer line is
 * the client's `discovery.maintained_by_service` message (spec 0002 i18n).
 */
export function isServiceMaintained(createdBy: string | null | undefined): boolean {
  const serviceAccountId = getServiceAccountId();
  return (createdBy ?? serviceAccountId) === serviceAccountId;
}
