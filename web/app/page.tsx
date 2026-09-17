import { headers } from "next/headers";
import { profileFromUser } from "@/lib/auth/profiles";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { appConfig } from "@/lib/config";
import { detectIpCity, findCity } from "@/lib/cities";
import { getProfile } from "@/lib/db/profile";
import { getMapKitConfig } from "@/lib/places/mapkit";
import { AuthCallbackError } from "@/components/auth/auth-callback-error";
import { CafeCreationTrigger } from "@/components/cafe/cafe-creation-sheet";
import { OnboardingHome } from "@/components/onboarding/onboarding-home";
import { MapSurface } from "@/components/map/map-surface";

/** Session + profile fetch with graceful degradation: Supabase or Postgres
 * outages degrade to the signed-out/anonymous view instead of a 500. */
async function loadSessionProfile(configured: boolean) {
  if (!configured) return { user: null, profile: null };
  const supabase = await createSupabaseServerClient();
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    return { user: null, profile: null };
  }
  if (!user) return { user: null, profile: null };
  try {
    return { user, profile: await getProfile(user.id) };
  } catch {
    // Postgres unavailable: treat as anonymous — localStorage carries the
    // onboarding state until the next signed-in visit merges it.
    return { user, profile: null };
  }
}

// Home = the map app (map-home, BRAWUKA-311): a full-viewport OpenFreeMap
// surface with the discovery sheet/sidebar bound to it. The onboarding
// welcome card and locate button ride the mapOverlay slot; the landing
// scaffold this page used to render is gone — the map IS the first
// impression now.
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const configured = isAuthConfigured();
  // The OAuth callback redirects here with ?auth=error on failure — surface
  // it instead of dropping the user back on a silent page (issue #98).
  const params = (await searchParams) ?? {};
  const authError = params.auth === "error";
  const authErrorReason = typeof params.reason === "string" ? params.reason : undefined;

  // First-visit onboarding (spec 0001 §Onboarding, DG114–DG123): the IP
  // detection is a header read — it never blocks render. For signed-in
  // users the profile's onboarded flag and stored city/location decide the
  // starting center and whether the card can appear at all (DG122).
  const detectedCity = detectIpCity(await headers());
  const { user, profile } = await loadSessionProfile(configured);
  const profileCity = profile ? findCity(profile.currentCity) : null;
  const initialCenter =
    profileCity?.center ??
    profile?.lastLocation ??
    detectedCity?.center ??
    appConfig.discovery.defaultCenter;
  const initialCafeId = typeof params.cafe === "string" ? params.cafe : undefined;
  // DG143: MapKit readiness is request-time — APPLE_MAPKIT_* are runtime env
  // in the Dokploy deploy; a build-time flag would bake false into the image.
  const mapkitConfigured = getMapKitConfig() !== null;
  const accountInitial = user
    ? (profile?.displayName ?? profileFromUser(user).displayName)[0]?.toUpperCase()
    : undefined;

  return (
    <OnboardingHome
      detectedCity={detectedCity}
      initialCenter={initialCenter}
      isAuthenticated={Boolean(user)}
      serverOnboarded={profile?.onboarded ?? false}
      profileSeed={
        profile
          ? { currentCity: profile.currentCity, lastLocation: profile.lastLocation }
          : undefined
      }
      suppressCard={initialCafeId !== undefined}
      addCafe={<CafeCreationTrigger isAuthenticated={Boolean(user)} mapkitConfigured={mapkitConfigured} variant="compact" />}
      addCafeFab={<CafeCreationTrigger isAuthenticated={Boolean(user)} mapkitConfigured={mapkitConfigured} variant="fab" />}
      accountInitial={accountInitial}
      mapkitConfigured={mapkitConfigured}
      initialCafeId={initialCafeId}
    >
      <MapSurface />
      {authError && (
        <div className="fixed inset-x-4 top-4 z-50 mx-auto max-w-md sm:inset-x-0">
          <AuthCallbackError reason={authErrorReason} />
        </div>
      )}
    </OnboardingHome>
  );
}
