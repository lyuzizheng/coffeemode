import "server-only";

/**
 * Shared map-app entry loader (DG124). `/` and `/cafes/[id]` hydrate into the
 * same map app, so the session/profile fetch, IP city detection, the
 * center-resolution chain, and request-time MapKit readiness resolve through
 * ONE loader — a forked copy would let the two entries drift (auth state,
 * onboarding suppression, city scope).
 *
 * The deep-link entry overrides only the center: the cafe's own coordinates
 * are the strongest signal (the map must focus the linked cafe and the
 * nearby query must contain it), ahead of the profile/detected/default
 * chain the home entry uses.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { profileFromUser } from "@/lib/auth/profiles";
import type { SessionUser } from "@/lib/auth/get-user";
import {
  VERIFIED_USER_HEADER,
  decodeVerifiedUser,
} from "@/lib/auth/verified-user";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { appConfig } from "@/lib/config";
import { detectIpCity, findCity, type CityInfo, type Coordinates } from "@/lib/cities";
import { getProfile } from "@/lib/db/profile";
import type { UserProfileDto } from "@/lib/db/profile/types";
import { getMapKitConfig } from "@/lib/places/mapkit";

export interface MapEntryProps {
  /** IP-detected launch city (DG128); null → no detection line. */
  detectedCity: CityInfo | null;
  /** Resolved starting center for the nearby query + map camera. */
  initialCenter: Coordinates;
  isAuthenticated: boolean;
  /** profiles.onboarded — authoritative for signed-in users (DG122). */
  serverOnboarded: boolean;
  /** Signed-in profile fields mirrored into localStorage on merge (DG122);
   * `currentCityName` carries the persisted runtime-city display name
   * (BRAWUKA-696). */
  profileSeed?: {
    currentCity: string;
    currentCityName?: string | null;
    lastLocation: Coordinates | null;
  };
  /** Signed-in display-name initial for the map account chip. */
  accountInitial?: string;
  /** DG143 request-time MapKit readiness — gates the Apple search CTA and
   * the creation sheet's provider tabs. */
  mapkitConfigured: boolean;
}

/**
 * Session + profile fetch with graceful degradation: Supabase or Postgres
 * outages degrade to the signed-out/anonymous view instead of a 500.
 * `cache()` dedupes it across the cafe lookup, generateMetadata, and
 * loadMapEntry within one request.
 *
 * BRAWUKA-644: on /cafes/[id] the proxy already ran getUser() and forwards
 * the verified identity on x-verified-user — reuse it so a signed-in page
 * view costs ONE getUser() network call, not two. Absent/malformed header
 * (every other route, or a proxy-side getUser failure) falls back to a
 * local getUser().
 */
export const loadMapSession = cache(
  async (): Promise<{ user: SessionUser | null; profile: UserProfileDto | null }> => {
    if (!isAuthConfigured()) return { user: null, profile: null };
    let user = decodeVerifiedUser((await headers()).get(VERIFIED_USER_HEADER));
    if (user === undefined) {
      const supabase = await createSupabaseServerClient();
      try {
        const { data } = await supabase.auth.getUser();
        user = data.user;
      } catch {
        return { user: null, profile: null };
      }
    }
    if (!user) return { user: null, profile: null };
    try {
      return { user, profile: await getProfile(user.id) };
    } catch {
      // Postgres unavailable: treat as anonymous — localStorage carries the
      // onboarding state until the next signed-in visit merges it.
      return { user, profile: null };
    }
  },
);

/**
 * Resolve the shared map-entry props. `centerOverride` is the deep-link
 * entry's cafe coordinates; omitted on the home entry, where the chain is
 * profile city → last location → detected city → configured default.
 */
export async function loadMapEntry(centerOverride?: Coordinates): Promise<MapEntryProps> {
  // The IP detection is a header read — it never blocks render (DG128).
  const detectedCity = detectIpCity(await headers());
  const { user, profile } = await loadMapSession();
  const profileCity = profile ? findCity(profile.currentCity) : null;
  const initialCenter =
    centerOverride ??
    profileCity?.center ??
    profile?.lastLocation ??
    detectedCity?.center ??
    appConfig.discovery.defaultCenter;
  const accountInitial = user
    ? (profile?.displayName ?? profileFromUser(user).displayName)[0]?.toUpperCase()
    : undefined;

  return {
    detectedCity,
    initialCenter,
    isAuthenticated: Boolean(user),
    serverOnboarded: profile?.onboarded ?? false,
    profileSeed: profile
      ? {
          currentCity: profile.currentCity,
          currentCityName: profile.currentCityName,
          lastLocation: profile.lastLocation,
        }
      : undefined,
    accountInitial,
    // DG143: MapKit readiness is request-time — APPLE_MAPKIT_* are runtime
    // env in the Dokploy deploy; a build-time flag would bake false into
    // the image.
    mapkitConfigured: getMapKitConfig() !== null,
  };
}
