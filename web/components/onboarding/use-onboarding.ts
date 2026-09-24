"use client";

/**
 * Onboarding state machine (spec 0001 §Onboarding, DG114–DG123). Owns the
 * welcome-card phase, the discovery center, and every geolocation/persist
 * transition; `OnboardingHome` renders it. Kept component-free so the
 * contract is testable without the DOM.
 *
 * - Card shows once: localStorage flag for anonymous visits,
 *   `profiles.onboarded` authoritative for signed-in users (DG122); on login
 *   the anonymous state merges into the profile via PATCH /api/profile.
 * - Skip lands on the IP-detected city (else Singapore) (DG116); the OS
 *   prompt fires only behind an explicit tap (DG112/DG118).
 * - Grant renders the user-location dot and recenters ONLY when the user
 *   has not panned since the card appeared (DG119/DG120); a pan latches
 *   via `handleCameraGesture` and the grant then just drops the dot.
 *   Re-tapping locate always recenters on the dot (DG120).
 * - Out-of-coverage grants resolve to the runtime city and raise the
 *   first-nomad toast (DG121). Denial keeps the card with the
 *   picker-focused recovery state (DG117).
 * - Offline grants still dismiss and recenter (DG123) — the locate POST is
 *   best-effort.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "@heroui/react";
import { useTranslations, useLocale } from "next-intl";
import {
  DEFAULT_CITY,
  findCity,
  type CityInfo,
  type Coordinates,
} from "@/lib/cities";
import { getOnboardingGeolocationTimeoutMs } from "@/lib/client-env";
import {
  isGeolocationDenied,
  requestPosition,
  type GeoResult,
} from "@/lib/geolocation";
import {
  hasShownLocateSettingsToast,
  markLocateSettingsToastShown,
  readOnboardingState,
  writeOnboardingState,
  type OnboardingState as OnboardingStoreState,
} from "@/lib/onboarding-store";
import { commitLocatedCity, postLocate } from "@/lib/onboarding-client";
import type { UserLocation } from "@/lib/discovery/map-context";
import {
  buildOnboardingState,
  type OnboardingPhase,
  type OnboardingState,
  type ProfileSeed,
} from "./onboarding-state";
import { persistProfile } from "@/lib/profile-merge";

export type { OnboardingPhase, OnboardingState };

/** Anonymous returning visitors resume at their stored city/location before
 * the first nearby fetch — the lazy initializer reads localStorage during
 * hydration; center only feeds the query key, never markup. For signed-in
 * users the server-computed `initialCenter` is authoritative (DG122).
 * Deep-link arrivals (`suppressStored`) also keep the server center — the
 * linked cafe's coordinates outrank any stored resumption point (DG124). */
function useOnboardingCenter(
  initialCenter: Coordinates,
  isAuthenticated: boolean,
  suppressStored: boolean,
) {
  return useState<Coordinates>(() => {
    if (isAuthenticated || suppressStored) return initialCenter;
    const stored = readOnboardingState();
    if (!stored) return initialCenter;
    const storedCity = stored.currentCity ? findCity(stored.currentCity) : null;
    return storedCity?.center ?? stored.lastLocation ?? initialCenter;
  });
}

/** The server's persisted runtime-city name wins over the localStorage
 * mirror; a server null is authoritative (cleared), an absent field falls
 * back to the stored copy. */
function resolveMergedCityName(
  city: string,
  stored: OnboardingStoreState | null,
  serverName?: string | null,
): string | null {
  if (findCity(city)) return null;
  if (serverName !== undefined) return serverName;
  return stored?.currentCity === city ? (stored.currentCityName ?? null) : null;
}

/** Mount reconciliation (DG122): anonymous onboarded state merges into the
 * profile; a server-onboarded profile seeds localStorage for later
 * signed-out visits on this device. */
function useOnboardingMerge(
  serverOnboarded: boolean,
  isAuthenticated: boolean,
  profileSeed?: ProfileSeed,
) {
  useEffect(() => {
    const stored = readOnboardingState();
    if (serverOnboarded) {
      const city = profileSeed?.currentCity;
      writeOnboardingState({
        onboarded: true,
        ...(city
          ? { currentCity: city, currentCityName: resolveMergedCityName(city, stored, profileSeed?.currentCityName) }
          : {}),
        ...(profileSeed?.lastLocation ? { lastLocation: profileSeed.lastLocation } : {}),
      });
      return;
    }
    if (!stored || !isAuthenticated) return;
    const patch: Parameters<typeof persistProfile>[0] = {};
    if (stored.onboarded) patch.onboarded = true;
    if (stored.currentCity) patch.currentCity = stored.currentCity;
    if (stored.lastLocation) patch.lastLocation = stored.lastLocation;
    if (Object.keys(patch).length > 0) void persistProfile(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The dot restores from the last granted fix (DG120 session persistence):
 * signed-in users take the profile's lastLocation, anonymous visitors the
 * localStorage copy — same precedence as the center fallback. */
function useUserLocationSeed(
  isAuthenticated: boolean,
  profileSeed?: ProfileSeed,
) {
  return useState<UserLocation | null>(() =>
    isAuthenticated
      ? (profileSeed?.lastLocation ?? null)
      : (readOnboardingState()?.lastLocation ?? null),
  );
}

/** The two explicit-tap geolocation entries (DG112): the card's enable
 * button and the persistent locate button. Grants route to separate
 * callbacks: enable respects the pan latch (DG119), locate always
 * recenters (DG120). */
function useLocateFlow({
  onEnableGranted,
  onLocateGranted,
  onCardDenied,
  onLocateDenied,
  onLocateFailed,
  initialPulseKey = 0,
}: {
  onEnableGranted: (result: Extract<GeoResult, { ok: true }>) => void;
  onLocateGranted: (result: Extract<GeoResult, { ok: true }>) => void;
  onCardDenied: (reason: "denied" | "unavailable" | "unsupported") => void;
  onLocateDenied: () => void;
  onLocateFailed: () => void;
  /** ?locate=1 deep link: the button arrives already pulsing (DG112 — a
   * hint, never an auto-prompt). */
  initialPulseKey?: number;
}) {
  const [locating, setLocating] = useState(false);
  const [pulseKey, setPulseKey] = useState(initialPulseKey);

  const request = async (): Promise<GeoResult> => {
    if (await isGeolocationDenied()) return { ok: false, reason: "denied" };
    return requestPosition(getOnboardingGeolocationTimeoutMs());
  };

  const enable = async () => {
    setLocating(true);
    const result = await request();
    setLocating(false);
    if (!result.ok) {
      onCardDenied(result.reason);
      return;
    }
    onEnableGranted(result);
  };

  const locate = async () => {
    setPulseKey((key) => key + 1);
    setLocating(true);
    const result = await request();
    setLocating(false);
    if (!result.ok) {
      if (result.reason === "denied") onLocateDenied();
      else onLocateFailed();
      return;
    }
    onLocateGranted(result);
  };

  return { locating, pulseKey, enable, locate };
}

/** DG123: an explicit city pick persists locally first; the profile merge is
 * best-effort — a failed PATCH retries on the next authenticated visit. */
function commitCityChoice(
  city: CityInfo,
  isAuthenticated: boolean,
  setCenter: (center: Coordinates) => void,
  setLocated: (located: boolean) => void,
  setPhase: (phase: OnboardingPhase) => void,
) {
  writeOnboardingState({
    onboarded: true,
    currentCity: city.id,
    currentCityName: null,
  });
  setCenter(city.center);
  setLocated(false);
  setPhase("done");
  if (isAuthenticated) {
    void persistProfile({ onboarded: true, currentCity: city.id });
  }
}

/** Commit paths: explicit city choice (skip/pick/use-city) and the granted
 * geolocation (DG119/DG120/DG123). Both persist locally first. */
function useOnboardingCommit({
  isAuthenticated,
  locateHint = false,
  setCenter,
  setLocated,
  setPhase,
  setUserLocation,
}: {
  isAuthenticated: boolean;
  setCenter: (center: Coordinates) => void;
  setLocated: (located: boolean) => void;
  setPhase: (phase: OnboardingPhase) => void;
  setUserLocation: (location: UserLocation) => void;
  locateHint?: boolean;
}) {
  const t = useTranslations("onboarding");
  const locale = useLocale();

  const commitCity = (city: CityInfo) =>
    commitCityChoice(city, isAuthenticated, setCenter, setLocated, setPhase);

  /** DG119/DG120: the grant always drops the dot; the camera only follows
   * when `recenter` is true — the locate tap always recenters, the card's
   * enable button only while the user has not panned. */
  const applyGrantedLocation = async (
    result: Extract<GeoResult, { ok: true }>,
    recenter: boolean,
  ) => {
    const { lat, lng } = result;
    setUserLocation({ lat, lng, accuracyM: result.accuracyM });
    if (recenter) setCenter({ lat, lng });
    setLocated(true);
    setPhase("done");
    writeOnboardingState({ onboarded: true, lastLocation: { lat, lng } });
    const city = await postLocate(lat, lng);
    if (!city) return;
    const cityName = await commitLocatedCity(
      city,
      { lat, lng },
      isAuthenticated,
      locale === "zh" ? "zh-CN" : "en-US",
    );
    if (city.runtime) {
      toast(t("first_nomad", { city: cityName ?? city.name }), { timeout: 6000 });
    }
  };

  // DG119: the first user camera gesture latches — a grant after that must
  // not steal the viewport the user already chose. Programmatic flyTo never
  // reaches this latch (the provider only fires it on real input).
  const userPanned = useRef(false);
  const handleCameraGesture = () => {
    userPanned.current = true;
  };

  // The card's enable honors "no recenter after user pan" (DG119); the
  // locate button is the explicit recenter affordance (DG120).
  const handleEnableGranted = (result: Extract<GeoResult, { ok: true }>) =>
    void applyGrantedLocation(result, !userPanned.current);
  const handleLocateGranted = (result: Extract<GeoResult, { ok: true }>) =>
    void applyGrantedLocation(result, true);

  const deniedToasts = useDeniedToasts(setPhase);
  const { locating, pulseKey, enable, locate } = useLocateFlow({
    onEnableGranted: handleEnableGranted,
    onLocateGranted: handleLocateGranted,
    initialPulseKey: locateHint ? 1 : 0,
    ...deniedToasts,
  });

  return {
    commitCity,
    handleCameraGesture,
    locating,
    pulseKey,
    enable,
    locate,
  };
}

/** Denied/failure toasts (DG117): the card's recovery state and the locate
 * button's one-time settings hint. */
function useDeniedToasts(setPhase: (phase: OnboardingPhase) => void) {
  const t = useTranslations("onboarding");
  return {
    onCardDenied: (reason: "denied" | "unavailable" | "unsupported") => {
      setPhase("denied");
      toast(
        reason === "denied" ? t("declined_toast") : t("unavailable_toast"),
        { timeout: 4000 },
      );
    },
    onLocateDenied: () => {
      if (hasShownLocateSettingsToast()) return;
      markLocateSettingsToastShown();
      toast(t("settings_toast"), { timeout: 4000 });
    },
    onLocateFailed: () => toast(t("unavailable_toast"), { timeout: 4000 }),
  };
}

interface UseOnboardingOptions {
  /** IP-detected launch city (DG128); null → no detection line. */
  detectedCity: CityInfo | null;
  /** Server-computed starting center: profile city → last location →
   * detected city → configured default. */
  initialCenter: Coordinates;
  isAuthenticated: boolean;
  /** profiles.onboarded — authoritative for signed-in users (DG122). */
  serverOnboarded: boolean;
  /** Signed-in profile fields mirrored into localStorage on merge (DG122). */
  profileSeed?: ProfileSeed;
  /** Deep-link arrivals (/cafes/[id]) never see the card (DG124). */
  suppressCard?: boolean;
  /** ?locate=1 deep link (BRAWUKA-504): the locate button arrives already
   * pulsing — a hint, never an auto-prompt (DG112 still requires a tap). */
  locateHint?: boolean;
}

export function useOnboarding({
  detectedCity,
  initialCenter,
  isAuthenticated,
  serverOnboarded,
  profileSeed,
  suppressCard,
  locateHint = false,
}: UseOnboardingOptions): OnboardingState {
  const [phase, setPhase] = useState<OnboardingPhase>(() =>
    serverOnboarded || suppressCard || readOnboardingState()?.onboarded
      ? "done"
      : "card",
  );
  const [userLocation, setUserLocation] = useUserLocationSeed(
    isAuthenticated,
    profileSeed,
  );
  const [located, setLocated] = useState(() => userLocation !== null);
  const [selectedCityId, setSelectedCityId] = useState(
    detectedCity?.id ?? DEFAULT_CITY.id,
  );
  const [center, setCenter] = useOnboardingCenter(
    initialCenter,
    isAuthenticated,
    // Deep-link arrivals (DG124): the linked cafe's coordinates are the
    // center — a stored city/location must never pull the map away from it.
    suppressCard ?? false,
  );

  useOnboardingMerge(serverOnboarded, isAuthenticated, profileSeed);

  const {
    commitCity,
    handleCameraGesture,
    locating,
    pulseKey,
    enable,
    locate,
  } = useOnboardingCommit({
    isAuthenticated,
    locateHint,
    setCenter,
    setLocated,
    setPhase,
    setUserLocation,
  });

  return buildOnboardingState({
    phase,
    locating,
    located,
    pulseKey,
    selectedCityId,
    center,
    userLocation,
    handleCameraGesture,
    enable,
    locate,
    commitCity,
    detectedCity,
    setCenter,
    setSelectedCityId,
  });
}

