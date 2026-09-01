/**
 * DG136 ranking preference — user-selected search ranking mode, persisted to
 * localStorage (never `profiles`) so anonymous sessions work. Follows the
 * `recent-searches.ts` storage pattern: quota-safe writes, change event for
 * `useSyncExternalStore`, and a strict value whitelist on read.
 *
 * `null` means "user never chose" — callers must then omit `?ranking=` so the
 * server default (`app.yaml:search.rankingMode`) applies.
 */
export type RankingPreference = "relevance" | "good_first";

const STORAGE_KEY = "coffeemode:search_ranking:v1";
const CHANGE_EVENT = "coffeemode:search-ranking-changed";

function isRankingPreference(value: unknown): value is RankingPreference {
  return value === "relevance" || value === "good_first";
}

export function getRankingPreference(): RankingPreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isRankingPreference(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setRankingPreference(preference: RankingPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Ignore localStorage write failures (e.g. quota or private mode)
  }
}

export function subscribeRankingPreference(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

// Snapshot pair for useSyncExternalStore — cached so the reference is stable
// across renders (getSnapshot must not return a fresh value every call).
let cachedRaw: string | null = null;
let cachedValue: RankingPreference | null = null;

export function getRankingPreferenceSnapshot(): RankingPreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    cachedValue = getRankingPreference();
    return cachedValue;
  } catch {
    return null;
  }
}

export function getRankingPreferenceServerSnapshot(): RankingPreference | null {
  return null;
}
