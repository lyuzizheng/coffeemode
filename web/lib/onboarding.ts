import "server-only";

import { appConfig } from "@/lib/config";
import { nearestLaunchCity } from "@/lib/cities";
import { resolveCafeTimezone } from "@/lib/db/cafes/meta";

/**
 * Located-city resolution (spec 0001 §Onboarding, DG121): a granted
 * geolocation maps to the nearest launch city inside
 * `onboarding.cityCoverageKm`; beyond it the coordinates become a
 * tz-lookup-named runtime city (BRAWUKA-640: `cf-ipcity` is
 * client-forgeable and never names or writes `current_city`).
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
  // a client-controlled header (BRAWUKA-640). The id derives from the
  // tz-lookup zone (`Europe/Lisbon` → `lisbon`,
  // `America/Argentina/Buenos_Aires` → `argentina-buenos-aires`); Etc/GMT*
  // zones carry no city, so `{city}` stays null instead of minting a bogus id.
  const tz = resolveCafeTimezone(lat, lng);
  const zoneCity = tz.split("/").slice(1).join("-").toLowerCase();
  const id = zoneCity.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!zoneCity || !id || tz.startsWith("Etc/")) return { inCoverage: false, city: null };
  const displayName = zoneCity
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
  return {
    inCoverage: false,
    city: {
      id,
      name: displayName,
      nameZh: displayName,
      tz,
      center: { lat, lng },
      runtime: true,
    },
  };
}
