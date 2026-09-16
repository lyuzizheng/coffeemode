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
import { MapAccountChip } from "@/components/map/map-account-chip";
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
  initialCafeId,
  accountInitial,
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
  initialCafeId?: string;
  /** Signed-in display-name initial for the map account chip; absent → the
   * chip shows the sign-in affordance (BRAWUKA-318). */
  accountInitial?: string;
  children: ReactNode;
}) {
  const mounted = useMounted();
  const onboarding = useOnboarding({
    detectedCity,
    initialCenter,
    isAuthenticated,
    serverOnboarded,
    profileSeed,
    suppressCard,
  });

  return (
    <DiscoveryHome
      center={onboarding.center}
      addCafe={addCafe}
      initialCafeId={initialCafeId}
      isAuthenticated={isAuthenticated}
      mapOverlay={
        mounted ? (
          <MapOverlay
            detectedCity={detectedCity}
            onboarding={onboarding}
            accountInitial={accountInitial}
          />
        ) : null
      }
    >
      {children}
    </DiscoveryHome>
  );
}

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
      {/* Account + theme affordances are visible in every phase — the card
          is bottom-anchored, the chip top-right; they never overlap. */}
      <MapAccountChip accountInitial={accountInitial} />
    </>
  );
}

