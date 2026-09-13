import "server-only";

import { appConfig } from "@/lib/config";
import { detectIpCity, nearestLaunchCity } from "@/lib/cities";
import { resolveCafeTimezone } from "@/lib/db/cafes/meta";

/**
 * Located-city resolution (spec 0001 §Onboarding, DG121): a granted
 * geolocation maps to the nearest launch city inside
 * `onboarding.cityCoverageKm`; beyond it the `cf-ipcity` header names the
 * runtime-created city (no geocoder exists yet — the header is the only
 * honest name source). `runtime: true` marks the DG121 first-nomad case.
 */

export interface ResolvedCity {
  id: string;
  name: string;
  nameZh: string;
  tz: string;
  center: { lat: number; lng: number };
  runtime: boolean;
}

export interface LocateResolution {
  city: ResolvedCity | null;
  inCoverage: boolean;
}

export function resolveLocatedCity(
  lat: number,
  lng: number,
  headers: { get(name: string): string | null },
): LocateResolution {
  const nearest = nearestLaunchCity(lat, lng, appConfig.onboarding.cityCoverageKm);
  if (nearest) {
    return {
      inCoverage: true,
      city: {
        id: nearest.id,
        name: nearest.name,
        nameZh: nearest.nameZh,
        tz: nearest.tz,
        center: nearest.center,
        runtime: false,
      },
    };
  }

  // Out of coverage: a launch-city IP hit needs no runtime row; a non-launch
  // cf-ipcity name becomes the runtime city (DG121).
  const ipCity = detectIpCity(headers);
  if (ipCity) {
    return {
      inCoverage: false,
      city: {
        id: ipCity.id,
        name: ipCity.name,
        nameZh: ipCity.nameZh,
        tz: ipCity.tz,
        center: ipCity.center,
        runtime: false,
      },
    };
  }

  const rawIpCity = headers.get("cf-ipcity")?.trim();
  if (!rawIpCity) return { inCoverage: false, city: null };

  return {
    inCoverage: false,
    city: {
      id: rawIpCity.toLowerCase().replace(/[\s\-_/]+/g, "-"),
      name: rawIpCity,
      nameZh: rawIpCity,
      tz: resolveCafeTimezone(lat, lng),
      center: { lat, lng },
      runtime: true,
    },
  };
}
