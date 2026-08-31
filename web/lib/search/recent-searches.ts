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
let cachedSearches: RecentSearchItem[] = EMPTY_SEARCHES;
let cachedRaw: string | null = null;

export function getRecentSearches(): RecentSearchItem[] {
  if (typeof window === "undefined") return EMPTY_SEARCHES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SEARCHES;
    const parsed = JSON.parse(raw) as unknown;
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
    return filtered.length === 0 ? EMPTY_SEARCHES : filtered;
  } catch {
    return EMPTY_SEARCHES;
  }
}

export function subscribeRecentSearches(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("coffeemode:recent-searches-changed", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("coffeemode:recent-searches-changed", callback);
    window.removeEventListener("storage", callback);
  };
}

export function getRecentSearchesSnapshot(): RecentSearchItem[] {
  if (typeof window === "undefined") return EMPTY_SEARCHES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedSearches;
    cachedRaw = raw;
    cachedSearches = getRecentSearches();
    return cachedSearches;
  } catch {
    return EMPTY_SEARCHES;
  }
}

export function getRecentSearchesServerSnapshot(): RecentSearchItem[] {
  return EMPTY_SEARCHES;
}

export function addRecentSearch(query: string, city: string): void {
  if (typeof window === "undefined") return;
  const trimmed = query.trim();
  if (!trimmed) return;

  try {
    const current = getRecentSearches();
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

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event("coffeemode:recent-searches-changed"));
  } catch {
    // Ignore localStorage write failures (e.g. quota or private mode)
  }
}

export function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event("coffeemode:recent-searches-changed"));
  } catch {
    // Ignore errors
  }
}
