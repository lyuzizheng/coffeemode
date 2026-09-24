import { createLocalStore } from "@/lib/local-store";

/**
 * DG136 ranking preference — user-selected search ranking mode, persisted to
 * localStorage (never `profiles`) so anonymous sessions work. Follows the
 * `createLocalStore<T>` storage pattern: quota-safe writes, change event for
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

const store = createLocalStore<RankingPreference | null>({
  key: STORAGE_KEY,
  changeEvent: CHANGE_EVENT,
  fallback: null,
  validate: (parsed) => (isRankingPreference(parsed) ? parsed : null),
});

export const getRankingPreference = store.get;

export function setRankingPreference(preference: RankingPreference): void {
  store.set(preference);
}

export const subscribeRankingPreference = store.subscribe;
export const getRankingPreferenceSnapshot = store.getSnapshot;
export const getRankingPreferenceServerSnapshot = store.getServerSnapshot;
