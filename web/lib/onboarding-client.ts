/**
 * Client call for POST /api/onboarding/locate (DG121): resolves a granted
 * geolocation to the current city server-side. Returns the resolved city or
 * null on any failure — offline grants still dismiss the card (DG123), so
 * callers treat null as "resolve later", never as an error surface.
 */
import { apiFetch } from "@/lib/http";
import { writeOnboardingState } from "@/lib/onboarding-store";
import { reverseGeocodeLocality } from "@/lib/places/apple-place-search";
import { persistProfile } from "@/lib/profile-merge";

/**
 * Client view of the located city (BRAWUKA-503: merge with server
 * `ResolvedCity` evaluated and rejected — the server shape carries `tz` for
 * runtime-city creation while this client shape never needs it, and sharing
 * the server type would pull `server-only` across the client boundary).
 */
export interface ResolvedLocateCity {
  id: string;
  name: string;
  nameZh: string;
  center: { lat: number; lng: number };
  runtime: boolean;
}

export async function postLocate(
  lat: number,
  lng: number,
): Promise<ResolvedLocateCity | null> {
  try {
    const body = await apiFetch<{ city: ResolvedLocateCity | null }>(
      "/api/onboarding/locate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      },
    );
    return body?.city ?? null;
  } catch {
    return null;
  }
}

/**
 * Commit a located city to local state and, for signed-in users, the precise
 * display name to the profile (BRAWUKA-696). The runtime city's name upgrades
 * from the honest country fallback to the MapKit JS reverse-geocoded locality;
 * anonymous visitors keep the fallback (the token endpoint requires a session)
 * and every geocode failure resolves null — nothing here blocks the grant
 * flow. Returns the display name for the caller's toast.
 */
export async function commitLocatedCity(
  city: ResolvedLocateCity,
  coords: { lat: number; lng: number },
  isAuthenticated: boolean,
  mapkitLanguage: string,
): Promise<string | null> {
  const locality =
    city.runtime && isAuthenticated
      ? await reverseGeocodeLocality(coords.lat, coords.lng, mapkitLanguage)
      : null;
  // Store only the precise locality — null keeps displayCityName's localized
  // country fallback (storing city.name would pin the English country name
  // into zh surfaces). Launch cities store null: findCity owns their names.
  writeOnboardingState({ currentCity: city.id, currentCityName: locality });
  if (locality) void persistProfile({ currentCityName: locality });
  return city.runtime ? (locality ?? city.name) : null;
}
