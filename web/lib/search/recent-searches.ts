import { createLocalStore } from "@/lib/local-store";

export interface RecentSearchItem {
  id: string;
  query: string;
  city: string;
  timestamp: number;
}

const STORAGE_KEY = "coffeemode:recent_searches:v1";
const DEFAULT_MAX_RECENT_SEARCHES = 20;

function getMaxRecentSearches(): number {
  const raw = process.env.NEXT_PUBLIC_RECENT_SEARCHES_MAX;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_RECENT_SEARCHES;
}

const EMPTY_SEARCHES: RecentSearchItem[] = [];

const store = createLocalStore<RecentSearchItem[]>({
  key: STORAGE_KEY,
  changeEvent: "coffeemode:recent-searches-changed",
  fallback: EMPTY_SEARCHES,
  validate: (parsed) => {
    if (!Array.isArray(parsed)) return EMPTY_SEARCHES;
    const filtered = parsed.filter(
      (item): item is RecentSearchItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RecentSearchItem).id === "string" &&
        typeof (item as RecentSearchItem).query === "string" &&
        typeof (item as RecentSearchItem).city === "string" &&
        typeof (item as RecentSearchItem).timestamp === "number",
    );
    if (filtered.length === 0) return EMPTY_SEARCHES;
    const max = getMaxRecentSearches();
    return filtered.length > max ? filtered.slice(0, max) : filtered;
  },
});

export const getRecentSearches = store.get;
export const subscribeRecentSearches = store.subscribe;
export const getRecentSearchesSnapshot = store.getSnapshot;
export const getRecentSearchesServerSnapshot = store.getServerSnapshot;

export function addRecentSearch(query: string, city: string): void {
  if (typeof window === "undefined") return;
  const trimmed = query.trim();
  if (!trimmed) return;

  const current = store.get();
  const filtered = current.filter(
    (item) => !(item.query.toLowerCase() === trimmed.toLowerCase() && item.city.toLowerCase() === city.toLowerCase()),
  );
  const updated: RecentSearchItem[] = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      query: trimmed,
      city,
      timestamp: Date.now(),
    },
    ...filtered,
  ].slice(0, getMaxRecentSearches());

  store.set(updated);
}

export const clearRecentSearches = store.remove;
