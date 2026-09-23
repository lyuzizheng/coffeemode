import { loadMapEntry } from "@/lib/discovery/map-entry";
import { AuthCallbackError } from "@/components/auth/auth-callback-error";
import { CafeCreationTrigger } from "@/components/cafe/cafe-creation-sheet";
import { OnboardingHome } from "@/components/onboarding/onboarding-home";
import { MapSurface } from "@/components/map/map-surface";

// Home = the map app (map-home, BRAWUKA-311): a full-viewport OpenFreeMap
// surface with the discovery sheet/sidebar bound to it. The onboarding
// welcome card and locate button ride the mapOverlay slot; the landing
// scaffold this page used to render is gone — the map IS the first
// impression now.
//
// DG124: the retired /?cafe=[id] entry 308-redirects to /cafes/[id]
// (proxy.ts) — no params.cafe handling lives here anymore. Session,
// center resolution, and MapKit readiness come from the shared map-entry
// loader so this entry and the cafe deep link can never drift.
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The OAuth callback redirects here with ?auth=error on failure — surface
  // it instead of dropping the user back on a silent page (issue #98).
  const params = (await searchParams) ?? {};
  const authError = params.auth === "error";
  const authErrorReason = typeof params.reason === "string" ? params.reason : undefined;

  // First-visit onboarding (spec 0001 §Onboarding, DG114–DG123): the shared
  // loader resolves session + profile + detected city + starting center
  // (profile city → last location → detected city → configured default).
  const entry = await loadMapEntry();
  // Profile-guide deep links (BRAWUKA-504): ?locate=1 primes the locate
  // button's pulse, ?create=1 opens the creation sheet on arrival.
  const locateHint = params.locate === "1";
  const createHint = params.create === "1";
  // ?q= deep link (BRAWUKA-516): profile Search History rows land on the
  // map with the query pre-filled (useSearchState reads it from the URL) —
  // a deep-link arrival, so the welcome card stays suppressed like ?cafe=.
  const searchDeepLink = typeof params.q === "string" && params.q.trim() !== "";

  return (
    <OnboardingHome
      detectedCity={entry.detectedCity}
      initialCenter={entry.initialCenter}
      isAuthenticated={entry.isAuthenticated}
      serverOnboarded={entry.serverOnboarded}
      profileSeed={entry.profileSeed}
      addCafe={
        <CafeCreationTrigger
          isAuthenticated={entry.isAuthenticated}
          mapkitConfigured={entry.mapkitConfigured}
          variant="compact"
        />
      }
      addCafeFab={
        <CafeCreationTrigger
          isAuthenticated={entry.isAuthenticated}
          mapkitConfigured={entry.mapkitConfigured}
          variant="fab"
        />
      }
      suppressCard={searchDeepLink}
      accountInitial={entry.accountInitial}
      mapkitConfigured={entry.mapkitConfigured}
      locateHint={locateHint}
      createHint={createHint}
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
