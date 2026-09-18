"use client";

/**
 * First-visit onboarding orchestrator (spec 0001 §Onboarding, onboarding-v1,
 * DG114–DG123). Renders the existing DiscoveryHome underneath so the surface
 * stays live behind the welcome card — no tunnel, no scrim — and hands the
 * card + locate button to DiscoveryHome's mapOverlay slot, which keeps them
 * clear of the mobile sheet's half/full detail content.
 */
import type { ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import type { CityInfo, Coordinates } from "@/lib/cities";
import { useMounted } from "@/hooks/use-mounted";
import { DiscoveryHome } from "@/components/discovery/discovery-home";
import { AppMenu } from "@/components/layout/app-menu";
import { LocateButton } from "./locate-button";
import { useOnboarding, type OnboardingState } from "./use-onboarding";
import { WelcomeCard } from "./welcome-card";

export function OnboardingHome({
  detectedCity,
  initialCenter,
  isAuthenticated,
  serverOnboarded,
  profileSeed,
  suppressCard,
  addCafe,
  addCafeFab,
  initialCafeId,
  accountInitial,
  mapkitConfigured = false,
  locateHint = false,
  createHint = false,
  children,
}: {
  /** IP-detected launch city (DG128); null → no detection line. */
  detectedCity: CityInfo | null;
  /** Server-computed starting center: profile city → last location →
   * detected city → configured default. */
  initialCenter: Coordinates;
  isAuthenticated: boolean;
  /** profiles.onboarded — authoritative for signed-in users (DG122). */
  serverOnboarded: boolean;
  /** Signed-in profile fields mirrored into localStorage on merge (DG122). */
  profileSeed?: { currentCity: string; lastLocation: Coordinates | null };
  /** Deep-link-style arrivals (?cafe=) never see the card (DG124). */
  suppressCard?: boolean;
  addCafe: ReactNode;
  /** Round add-cafe FAB slot (BRAWUKA-364) — floats over the map. */
  addCafeFab?: ReactNode;
  initialCafeId?: string;
  /** Signed-in display-name initial for the map account chip; absent → the
   * chip shows the sign-in affordance (BRAWUKA-318). */
  accountInitial?: string;
  /** DG143 request-time MapKit readiness — forwarded to search + creation. */
  mapkitConfigured?: boolean;
  /** ?locate=1 deep link — the locate button arrives already pulsing. */
  locateHint?: boolean;
  /** ?create=1 deep link — the creation sheet opens on arrival. */
  createHint?: boolean;
  /** The map surface — rendered below every overlay. */
  children?: ReactNode;
}) {
  const mounted = useMounted();
  const onboarding = useOnboarding({
    detectedCity,
    initialCenter,
    isAuthenticated,
    serverOnboarded,
    profileSeed,
    suppressCard,
    locateHint,
  });
  return (
    <DiscoveryHome
      center={onboarding.center}
      addCafe={addCafe}
      addCafeFab={addCafeFab}
      initialCafeId={initialCafeId}
      isAuthenticated={isAuthenticated}
      mapkitConfigured={mapkitConfigured}
      city={detectedCity?.id}
      mapOverlay={
        mounted ? (
          <MapOverlay
            detectedCity={detectedCity}
            onboarding={onboarding}
            accountInitial={accountInitial}
          />
        ) : null
      }
      userLocation={onboarding.userLocation}
      onCameraGesture={onboarding.handleCameraGesture}
      initialCreationOpen={createHint}
    >
      {children}
    </DiscoveryHome>
  );
}

/** The props type extracted so OnboardingHome stays under the 80-line
 * function budget — every field is a pass-through to useOnboarding or
 * DiscoveryHome. */
export type OnboardingHomeProps = Parameters<typeof OnboardingHome>[0];

/** Welcome card + locate button + account/theme chip — everything that
 * floats over the map. DiscoveryHome's gateMapOverlay hides the whole slot
 * whenever the mobile sheet is above PEEK. */
function MapOverlay({
  detectedCity,
  onboarding,
  accountInitial,
}: {
  detectedCity: CityInfo | null;
  accountInitial?: string;
  onboarding: OnboardingState;
}) {
  return (
    <>
      <AnimatePresence>
        {onboarding.phase !== "done" && (
          <WelcomeCard
            detectedCity={detectedCity}
            denied={onboarding.phase === "denied"}
            locating={onboarding.locating}
            selectedCityId={onboarding.selectedCityId}
            onEnableLocation={() => void onboarding.handleEnableLocation()}
            onSkip={onboarding.handleSkip}
            onPickCity={onboarding.handlePickCity}
            onUseCity={onboarding.handleUseCity}
          />
        )}
      </AnimatePresence>
      {onboarding.phase === "done" && (
        <LocateButton
          locating={onboarding.locating}
          located={onboarding.located}
          pulseKey={onboarding.pulseKey}
          onLocate={() => void onboarding.handleLocate()}
        />
      )}
      {/* Account + menu cluster rides every phase — the card is
          bottom-anchored, the cluster top-right; they never overlap. */}
      <AppMenu accountInitial={accountInitial} />
    </>
  );
}

