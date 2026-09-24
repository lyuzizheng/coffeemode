import { createLocalStore } from "./local-store";

/**
 * Anonymous onboarding state (spec 0001 §Onboarding storage): the welcome
 * card's one-time flag plus the resolved current city and last granted
 * geolocation. Follows the `createLocalStore<T>` storage pattern — quota-safe
 * writes, strict shape check on read, corrupt or blocked storage degrades to
 * "first visit".
 *
 * Signed-in users merge this into `profiles` (DG122) via PATCH /api/profile;
 * the local copy stays as the anonymous fallback for signed-out visits.
 */

export interface OnboardingState {
  onboarded: boolean;
  /** Resolved current city id — launch id or runtime city id (DG121). */
  currentCity: string | null;
  /** Display name for runtime cities; launch ids resolve via findCity. */
  currentCityName: string | null;
  lastLocation: { lat: number; lng: number } | null;
}

const STORAGE_KEY = "coffeemode:onboarding:v1";
/** DG117: the denied-state locate tap shows the settings toast once, ever. */
const SETTINGS_TOAST_KEY = "coffeemode:onboarding:settings-toast-shown:v1";

function isLocation(value: unknown): value is { lat: number; lng: number } {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

const store = createLocalStore<OnboardingState | null>({
  key: STORAGE_KEY,
  changeEvent: "coffeemode:onboarding-changed",
  fallback: null,
  validate: (parsed) => {
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Partial<OnboardingState>;
    return {
      onboarded: p.onboarded === true,
      currentCity: typeof p.currentCity === "string" ? p.currentCity : null,
      currentCityName: typeof p.currentCityName === "string" ? p.currentCityName : null,
      lastLocation: isLocation(p.lastLocation) ? p.lastLocation : null,
    };
  },
});

export const readOnboardingState = store.get;
export const subscribeOnboardingStore = store.subscribe;
export const getOnboardingStateSnapshot = store.getSnapshot;
export const getOnboardingStateServerSnapshot = store.getServerSnapshot;

export function writeOnboardingState(patch: Partial<OnboardingState>): void {
  if (typeof window === "undefined") return;
  const current = store.get() ?? {
    onboarded: false,
    currentCity: null,
    currentCityName: null,
    lastLocation: null,
  };
  store.set({ ...current, ...patch });
}

export function hasShownLocateSettingsToast(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SETTINGS_TOAST_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLocateSettingsToastShown(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_TOAST_KEY, "1");
  } catch {
    // Best-effort; a repeat toast is a nuisance, not a bug.
  }
}
