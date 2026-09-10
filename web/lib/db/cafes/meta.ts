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

export const SERVICE_ACCOUNT_MAINTAINER_LABEL = "由 CoffeeMode 维护";

/** Resolves the display label for a cafe maintainer (display layer only). */
export function formatCafeMaintainer(createdBy: string | null | undefined): string | null {
  const serviceAccountId = getServiceAccountId();
  const effective = createdBy ?? serviceAccountId;
  return effective === serviceAccountId ? SERVICE_ACCOUNT_MAINTAINER_LABEL : null;
}
