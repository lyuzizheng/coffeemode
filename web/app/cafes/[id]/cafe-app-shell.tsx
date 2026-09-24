"use client";

/**
 * DG124 hydration handoff: the SSR shell (children) is the first paint; the
 * map app mounts beneath it from the same SSR pass, so hydration flips the
 * shell into the app's FULL sheet with no route change and no layout shift
 * (#275 — the overlay reserves the viewport from the first byte).
 *
 * - The app tree is the home entry's exact composition (OnboardingHome →
 *   DiscoveryHome → MapSurface) with `initialCafeId` + `initialSnap="full"`:
 *   the mobile sheet opens at FULL, the desktop detail column opens
 *   selected — the same dossier the shell showed.
 * - `suppressCard` kills the welcome card on this entry (DG124/DG112); the
 *   locate button remains the only geolocation surface.
 * - The shell fades out once mounted and unmounts after the transition —
 *   reduced-motion collapses the fade to ~0ms via the global kill switch.
 * - `inert` on the fading shell keeps taps/focus on the live app beneath.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { CityInfo, Coordinates } from "@/lib/cities";
import { useMounted } from "@/hooks/use-mounted";
import { OnboardingHome } from "@/components/onboarding/onboarding-home";
import { MapSurface } from "@/components/map/map-surface";
import { CafeCreationTrigger } from "@/components/cafe/cafe-creation-sheet";

/** Shell fade length — inside the spec 0002 settle budget; the global
 * reduced-motion kill switch collapses it to ~0ms. */
const SHELL_FADE_MS = 300;

export function CafeAppShell({
  cafeId,
  cafeCenter,
  city,
  detectedCity,
  isAuthenticated,
  serverOnboarded,
  profileSeed,
  accountInitial,
  mapkitConfigured,
  children,
}: {
  /** The page's cafe — selected at FULL when the app hydrates. */
  cafeId: string;
  /** The cafe's coordinates: the entry center (map focus + nearby query). */
  cafeCenter: Coordinates;
  /** Launch-city id for the search scope; undefined outside launch cities. */
  city?: string;
  detectedCity: CityInfo | null;
  isAuthenticated: boolean;
  serverOnboarded: boolean;
  profileSeed?: {
    currentCity: string;
    currentCityName?: string | null;
    lastLocation: Coordinates | null;
  };
  accountInitial?: string;
  mapkitConfigured: boolean;
  /** The SSR shell — first paint, then the fading overlay. */
  children: ReactNode;
}) {
  const mounted = useMounted();
  const [shellGone, setShellGone] = useState(false);

  // Unmount the shell after its fade so it never lingers in the a11y tree or
  // holds duplicate live queries. The timeout outlives the transition; with
  // reduced motion the fade is ~0ms and the shell still clears promptly.
  useEffect(() => {
    if (!mounted) return;
    const id = window.setTimeout(() => setShellGone(true), SHELL_FADE_MS + 100);
    return () => window.clearTimeout(id);
  }, [mounted]);

  const trigger = (variant: "compact" | "fab") => (
    <CafeCreationTrigger
      isAuthenticated={isAuthenticated}
      mapkitConfigured={mapkitConfigured}
      variant={variant}
    />
  );

  return (
    <>
      <OnboardingHome
        detectedCity={detectedCity}
        initialCenter={cafeCenter}
        isAuthenticated={isAuthenticated}
        serverOnboarded={serverOnboarded}
        profileSeed={profileSeed}
        suppressCard
        addCafe={trigger("compact")}
        addCafeFab={trigger("fab")}
        accountInitial={accountInitial}
        mapkitConfigured={mapkitConfigured}
        initialCafeId={cafeId}
        initialSnap="full"
        city={city}
      >
        <MapSurface />
      </OnboardingHome>

      <ShellOverlay mounted={mounted} gone={shellGone}>
        {children}
      </ShellOverlay>
    </>
  );
}

/** The SSR shell as the hydration overlay: opaque until mount, then it
 * fades and unmounts — pointer/focus inert from the moment the app is live. */
function ShellOverlay({
  mounted,
  gone,
  children,
}: {
  mounted: boolean;
  gone: boolean;
  children: ReactNode;
}) {
  if (gone) return null;
  return (
    <div
      inert={mounted}
      className={`fixed inset-0 z-50 overflow-y-auto bg-background transition-opacity duration-300 ${
        mounted ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {children}
    </div>
  );
}
