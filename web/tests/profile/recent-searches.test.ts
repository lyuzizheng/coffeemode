import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getRecentSearches,
  addRecentSearch,
  clearRecentSearches,
} from "@/lib/search/recent-searches";

describe("recent-searches helper", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });
  });

  it("returns empty array when storage is empty or malformed", () => {
    expect(getRecentSearches()).toEqual([]);

    store["coffeemode:recent_searches:v1"] = "invalid json";
    expect(getRecentSearches()).toEqual([]);
  });

  it("adds and retrieves searches in LIFO order", () => {
    addRecentSearch("Roastery", "singapore");
    addRecentSearch("Omotesando", "tokyo");

    const items = getRecentSearches();
    expect(items.length).toBe(2);
    expect(items[0]?.query).toBe("Omotesando");
    expect(items[0]?.city).toBe("tokyo");
    expect(items[1]?.query).toBe("Roastery");
  });

  it("deduplicates case-insensitively and puts the latest at the front", () => {
    addRecentSearch("Roastery", "singapore");
    addRecentSearch("Kiosk", "singapore");
    addRecentSearch("roastery", "singapore");

    const items = getRecentSearches();
    expect(items.length).toBe(2);
    expect(items[0]?.query).toBe("roastery");
    expect(items[1]?.query).toBe("Kiosk");
  });

  it("clears all searches", () => {
    addRecentSearch("Roastery", "singapore");
    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
  });
});
