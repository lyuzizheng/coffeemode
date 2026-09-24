import "server-only";

import { appConfig } from "@/lib/config";
import { nearestLaunchCity } from "@/lib/cities";
import { resolveCafeTimezone } from "@/lib/db/cafes/meta";

import {
  getCountryCodeForTimezone,
  getLocalizedCountryName,
} from "@/lib/timezone-countries";

/**
 * Located-city resolution (spec 0001 §Onboarding, DG121, BRAWUKA-695): a granted
 * geolocation maps to the nearest launch city inside
 * `onboarding.cityCoverageKm`; beyond it the coordinates become an
 * `rt-<zone>` runtime city with honest country-level fallback names.
 * `runtime: true` marks the DG121 first-nomad case.
 */

interface ResolvedCity {
  id: string;
  name: string;
  nameZh: string;
  tz: string;
  center: { lat: number; lng: number };
  runtime: boolean;
}

interface LocateResolution {
  city: ResolvedCity | null;
  inCoverage: boolean;
}

export function resolveLocatedCity(lat: number, lng: number): LocateResolution {
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

  // Out of coverage: the granted coordinates name the runtime city — never
  // a client-controlled header (BRAWUKA-640). The runtime id derives from the
  // tz-lookup zone with `rt-<zone>` namespace isolation (BRAWUKA-695):
  // zone.toLowerCase() with `/` -> `-`, keeping inner `_`.
  // e.g. `Asia/Shanghai` -> `rt-asia-shanghai`, `America/Argentina/Buenos_Aires` -> `rt-america-argentina-buenos_aires`.
  // Etc/* and ocean zones carry no country/city, returning `{ city: null }`.
  const tz = resolveCafeTimezone(lat, lng);
  if (!tz || tz.startsWith("Etc/") || tz === "UTC") return { inCoverage: false, city: null };
  const id = "rt-" + tz.toLowerCase().replace(/\//g, "-");
  const countryCode = getCountryCodeForTimezone(tz);
  if (!countryCode) return { inCoverage: false, city: null };
  const name = getLocalizedCountryName(countryCode, "en") || countryCode;
  const nameZh = getLocalizedCountryName(countryCode, "zh") || name;
  return {
    inCoverage: false,
    city: {
      id,
      name,
      nameZh,
      tz,
      center: { lat, lng },
      runtime: true,
    },
  };
}
