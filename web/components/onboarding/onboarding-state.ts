/**
 * Onboarding public surface + the return-object builder (spec 0001
 * §Onboarding, DG114–DG123). Split from `use-onboarding.ts` so the hook file
 * stays under the 400-line budget; `use-onboarding.ts` re-exports both types
 * so existing consumers keep their import path.
 */
import { DEFAULT_CITY, findCity, type CityInfo, type Coordinates } from "@/lib/cities";
import type { UserLocation } from "@/lib/discovery/map-context";

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
  /** Granted position rendered as the map dot — session-persistent (DG120). */
  userLocation: UserLocation | null;
  /** Latch for the map's first user camera gesture (DG119). */
  handleCameraGesture: () => void;
  handleEnableLocation: () => Promise<void>;
  handleLocate: () => Promise<void>;
  handlePickCity: (cityId: string) => void;
  handleUseCity: () => void;
  handleSkip: () => void;
}

/** The handlers + return object — extracted so useOnboarding stays under
 * the 80-line budget. Every field is a pass-through or a one-line wrapper. */
export function buildOnboardingState({
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
  setSelectedCityId,
  setCenter,
}: {
  phase: OnboardingPhase;
  locating: boolean;
  located: boolean;
  pulseKey: number;
  selectedCityId: string;
  center: Coordinates;
  userLocation: UserLocation | null;
  handleCameraGesture: () => void;
  enable: () => Promise<void>;
  locate: () => Promise<void>;
  commitCity: (city: CityInfo) => void;
  detectedCity: CityInfo | null;
  setSelectedCityId: (id: string) => void;
  setCenter: (c: Coordinates) => void;
}): OnboardingState {
  const handleLocate = async () => {
    // Re-tap recenters on the dot immediately — the contract is about the
    // camera, not a fresh fix; the grant below then refreshes the position.
    if (userLocation) setCenter({ lat: userLocation.lat, lng: userLocation.lng });
    await locate();
  };

  const handlePickCity = (cityId: string) => {
    setSelectedCityId(cityId);
    // Denied mode only stages the pick — "Use {city}" commits it. In the
    // normal state the pick IS the choice (artifact §2: two choices, one card).
    if (phase !== "denied") {
      const city = findCity(cityId);
      if (city) commitCity(city);
    }
  };

  const handleUseCity = () => {
    const city = findCity(selectedCityId);
    if (city) commitCity(city);
  };

  return {
    phase,
    locating,
    located,
    pulseKey,
    selectedCityId,
    center,
    userLocation,
    handleCameraGesture,
    handleEnableLocation: enable,
    handleLocate,
    handlePickCity,
    handleUseCity,
    handleSkip: () => commitCity(detectedCity ?? DEFAULT_CITY),
  };
}
