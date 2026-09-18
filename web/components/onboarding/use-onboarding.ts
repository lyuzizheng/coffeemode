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
 * - Grant recenters on the user; out-of-coverage grants resolve to the
 *   runtime city and raise the first-nomad toast (DG121). Denial keeps the
 *   card with the picker-focused recovery state (DG117).
 * - Offline grants still dismiss and recenter (DG123) — the locate POST is
 *   best-effort.
 */
import { useEffect, useState } from "react";
import { toast } from "@heroui/react";
import { useTranslations } from "next-intl";
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
} from "@/lib/onboarding-store";
import { postLocate } from "@/lib/onboarding-client";

export type OnboardingPhase = "card" | "denied" | "done";

/** The hook's public surface — named so overlay components can type the
 * orchestration result without coupling to the hook's internals. */
export interface OnboardingState {
  phase: OnboardingPhase;
  locating: boolean;
  located: boolean;
  pulseKey: number;
  selectedCityId: string;
  center: Coordinates;
  handleEnableLocation: () => Promise<void>;
  handleLocate: () => Promise<void>;
  handlePickCity: (cityId: string) => void;
  handleUseCity: () => void;
  handleSkip: () => void;
}

/** Best-effort profile merge — localStorage already holds the state, so a
 * failed PATCH just retries on the next authenticated visit. */
async function persistProfile(patch: {
  onboarded?: boolean;
  currentCity?: string;
  lastLocation?: Coordinates;
}): Promise<void> {
  try {
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    // Offline or unauthenticated race — local state is the fallback.
  }
}

/** Anonymous returning visitors resume at their stored city/location before
 * the first nearby fetch — the lazy initializer reads localStorage during
 * hydration; center only feeds the query key, never markup. For signed-in
 * users the server-computed `initialCenter` (profile city → last location →
 * detected city → default) is authoritative (DG122): a stale anonymous
 * `currentCity` on this device must never override it. Deep-link arrivals
 * (`suppressStored`) also keep the server center — the linked cafe's
 * coordinates outrank any stored resumption point (DG124). */
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

/** Mount reconciliation (DG122): anonymous onboarded state merges into the
 * profile; a server-onboarded profile seeds localStorage for later
 * signed-out visits on this device. The profile's city/location are also
 * mirrored down so the anonymous fallback can never go stale against the
 * authoritative row. */
function useOnboardingMerge(
  serverOnboarded: boolean,
  isAuthenticated: boolean,
  profileSeed?: { currentCity: string; lastLocation: Coordinates | null },
) {
  useEffect(() => {
    const stored = readOnboardingState();
    if (serverOnboarded) {
      writeOnboardingState({
        onboarded: true,
        ...(profileSeed?.currentCity
          ? { currentCity: profileSeed.currentCity }
          : {}),
        ...(profileSeed?.lastLocation
          ? { lastLocation: profileSeed.lastLocation }
          : {}),
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

/** The two explicit-tap geolocation entries (DG112): the card's enable
 * button and the persistent locate button. Both check the Permissions API
 * first — an OS-level denial can't re-prompt (DG117). */
function useLocateFlow({
  onGranted,
  onCardDenied,
  onLocateDenied,
  onLocateFailed,
}: {
  onGranted: (lat: number, lng: number) => void;
  onCardDenied: (reason: "denied" | "unavailable" | "unsupported") => void;
  onLocateDenied: () => void;
  onLocateFailed: () => void;
}) {
  const [locating, setLocating] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);

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
    onGranted(result.lat, result.lng);
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
    onGranted(result.lat, result.lng);
  };

  return { locating, pulseKey, enable, locate };
}

/** Commit paths: explicit city choice (skip/pick/use-city) and the granted
 * geolocation (DG119/DG120/DG123). Both persist locally first; the profile
 * merge and the server-side city resolution are best-effort. */
function useOnboardingCommit({
  isAuthenticated,
  setCenter,
  setLocated,
  setPhase,
}: {
  isAuthenticated: boolean;
  setCenter: (center: Coordinates) => void;
  setLocated: (located: boolean) => void;
  setPhase: (phase: OnboardingPhase) => void;
}) {
  const t = useTranslations("onboarding");

  const commitCity = (city: CityInfo) => {
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
  };

  const applyGrantedLocation = async (lat: number, lng: number) => {
    setCenter({ lat, lng });
    setLocated(true);
    setPhase("done");
    writeOnboardingState({ onboarded: true, lastLocation: { lat, lng } });
    const city = await postLocate(lat, lng);
    if (!city) return;
    writeOnboardingState({
      currentCity: city.id,
      currentCityName: city.runtime ? city.name : null,
    });
    if (city.runtime) {
      toast(t("first_nomad", { city: city.name }), { timeout: 6000 });
    }
  };

  return { commitCity, applyGrantedLocation };
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


/** Card city picker (DG116/DG117): the Select stages a pick; in the normal
 * phase the pick IS the choice, in denied mode "Use {city}" commits it. */
function useCityPicker({
  detectedCity,
  phase,
  commitCity,
}: {
  detectedCity: CityInfo | null;
  phase: OnboardingPhase;
  commitCity: (city: CityInfo) => void;
}) {
  const [selectedCityId, setSelectedCityId] = useState(
    detectedCity?.id ?? DEFAULT_CITY.id,
  );
  const handlePickCity = (cityId: string) => {
    setSelectedCityId(cityId);
    if (phase !== "denied") {
      const city = findCity(cityId);
      if (city) commitCity(city);
    }
  };
  const handleUseCity = () => {
    const city = findCity(selectedCityId);
    if (city) commitCity(city);
  };
  return { selectedCityId, handlePickCity, handleUseCity };
}
export function useOnboarding({
  detectedCity,
  initialCenter,
  isAuthenticated,
  serverOnboarded,
  profileSeed,
  suppressCard,
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
}): OnboardingState {

  // The card must never flash for returning visitors (DG122): the lazy
  // initializer reads localStorage during hydration — phase feeds only
  // client-gated overlay markup, never SSR output.
  const [phase, setPhase] = useState<OnboardingPhase>(() =>
    serverOnboarded || suppressCard || readOnboardingState()?.onboarded
      ? "done"
      : "card",
  );
  const [located, setLocated] = useState(false);
  const [center, setCenter] = useOnboardingCenter(
    initialCenter,
    isAuthenticated,
    // Deep-link arrivals (DG124): the linked cafe's coordinates are the
    // center — a stored city/location must never pull the map away from it.
    suppressCard ?? false,
  );

  useOnboardingMerge(serverOnboarded, isAuthenticated, profileSeed);

  const { commitCity, applyGrantedLocation } = useOnboardingCommit({
    isAuthenticated,
    setCenter,
    setLocated,
    setPhase,
  });

  const deniedToasts = useDeniedToasts(setPhase);
  const { locating, pulseKey, enable, locate } = useLocateFlow({
    onGranted: (lat, lng) => void applyGrantedLocation(lat, lng),
    ...deniedToasts,
  });

  const { selectedCityId, handlePickCity, handleUseCity } = useCityPicker({
    detectedCity,
    phase,
    commitCity,
  });

  return {
    phase,
    locating,
    located,
    pulseKey,
    selectedCityId,
    center,
    handleEnableLocation: enable,
    handleLocate: locate,
    handlePickCity,
    handleUseCity,
    handleSkip: () => commitCity(detectedCity ?? DEFAULT_CITY),
  };
}
