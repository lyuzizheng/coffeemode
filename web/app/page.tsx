import { headers } from "next/headers";
import { profileFromUser } from "@/lib/auth/profiles";
import { createSupabaseServerClient, isAuthConfigured } from "@/lib/auth/supabase-server";
import { appConfig } from "@/lib/config";
import { detectIpCity, findCity } from "@/lib/cities";
import { getProfile } from "@/lib/db/profile";
import { AuthCallbackError } from "@/components/auth/auth-callback-error";
import { CafeCreationTrigger } from "@/components/cafe/cafe-creation-sheet";
import { OnboardingHome } from "@/components/onboarding/onboarding-home";
import { MapSurface } from "@/components/map/map-surface";

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
  const authErrorReason =
    typeof params.reason === "string" ? params.reason : undefined;

  let user = null;
  if (configured) {
    const supabase = await createSupabaseServerClient();
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch {
      // Supabase unreachable: degrade to the signed-out view instead of
      // turning the whole page into a 500 (availability > session display).
      user = null;
    }
  }

  // First-visit onboarding (spec 0001 §Onboarding, DG114–DG123): the IP
  // detection is a header read — it never blocks render. For signed-in
  // users the profile's onboarded flag and stored city/location decide the
  // starting center and whether the card can appear at all (DG122).
  const requestHeaders = await headers();
  const detectedCity = detectIpCity(requestHeaders);
  let profile = null;
  if (user) {
    try {
      profile = await getProfile(user.id);
    } catch {
      // Postgres unavailable: treat as anonymous — localStorage carries the
      // onboarding state until the next signed-in visit merges it.
      profile = null;
    }
  }
  const profileCity = profile ? findCity(profile.currentCity) : null;
  const initialCenter =
    profileCity?.center ??
    profile?.lastLocation ??
    detectedCity?.center ??
    appConfig.discovery.defaultCenter;
  const initialCafeId = typeof params.cafe === "string" ? params.cafe : undefined;

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
      addCafe={<CafeCreationTrigger isAuthenticated={Boolean(user)} />}
      accountInitial={
        user
          ? (profile?.displayName ?? profileFromUser(user).displayName)[0]?.toUpperCase()
          : undefined
      }
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
