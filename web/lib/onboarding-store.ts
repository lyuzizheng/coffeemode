/**
 * Anonymous onboarding state (spec 0001 §Onboarding storage): the welcome
 * card's one-time flag plus the resolved current city and last granted
 * geolocation. Follows the `recent-searches.ts`/`ranking-preference.ts`
 * storage pattern — quota-safe writes, strict shape check on read, corrupt
 * or blocked storage degrades to "first visit".
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

export function readOnboardingState(): OnboardingState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      onboarded: parsed.onboarded === true,
      currentCity: typeof parsed.currentCity === "string" ? parsed.currentCity : null,
      currentCityName:
        typeof parsed.currentCityName === "string" ? parsed.currentCityName : null,
      lastLocation: isLocation(parsed.lastLocation) ? parsed.lastLocation : null,
    };
  } catch {
    return null;
  }
}

export function writeOnboardingState(patch: Partial<OnboardingState>): void {
  if (typeof window === "undefined") return;
  try {
    const current = readOnboardingState() ?? {
      onboarded: false,
      currentCity: null,
      currentCityName: null,
      lastLocation: null,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
    notifyOnboardingStore();
  } catch {
    // Quota/private-mode failures degrade to "card shows again" — harmless.
  }
}

/** Subscribers notified after every successful write — lets consumers
 * (e.g. the search city scope) re-read the store instead of snapshotting
 * it once at mount. */
const listeners = new Set<() => void>();

export function subscribeOnboardingStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyOnboardingStore(): void {
  for (const listener of listeners) listener();
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
