import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createLocalStore } from "@/lib/local-store";
import {
  getRankingPreference,
  setRankingPreference,
  subscribeRankingPreference,
  getRankingPreferenceSnapshot,
  getRankingPreferenceServerSnapshot,
} from "@/lib/search/ranking-preference";
import {
  getRecentSearches,
  addRecentSearch,
  clearRecentSearches,
  subscribeRecentSearches,
  getRecentSearchesSnapshot,
  getRecentSearchesServerSnapshot,
} from "@/lib/search/recent-searches";
import {
  readOnboardingState,
  writeOnboardingState,
  subscribeOnboardingStore,
  hasShownLocateSettingsToast,
  markLocateSettingsToastShown,
} from "@/lib/onboarding-store";

describe("createLocalStore (BRAWUKA-426 / OPT-1)", () => {
  const TEST_KEY = "coffeemode:test_store:v1";
  const CHANGE_EVENT = "coffeemode:test-store-changed";

  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("read and fallback behavior", () => {
    it("returns fallback when key is not present in localStorage", () => {
      const store = createLocalStore<string>({
        key: TEST_KEY,
        fallback: "default_value",
      });

      expect(store.get()).toBe("default_value");
      expect(store.getServerSnapshot()).toBe("default_value");
    });

    it("returns fallback when JSON in localStorage is corrupted", () => {
      window.localStorage.setItem(TEST_KEY, "{corrupt json:::");
      const store = createLocalStore<{ name: string }>({
        key: TEST_KEY,
        fallback: { name: "fallback" },
      });

      expect(store.get()).toEqual({ name: "fallback" });
    });

    it("returns fallback when validator rejects parsed value", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify({ count: -5 }));
      const store = createLocalStore<number>({
        key: TEST_KEY,
        fallback: 0,
        validate: (parsed) => {
          if (typeof parsed === "object" && parsed !== null && "count" in parsed) {
            const count = (parsed as { count: unknown }).count;
            if (typeof count === "number" && count >= 0) return count;
          }
          return 0;
        },
      });

      expect(store.get()).toBe(0);
    });

    it("returns validated value when parsed value is valid", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify({ count: 42 }));
      const store = createLocalStore<number>({
        key: TEST_KEY,
        fallback: 0,
        validate: (parsed) => {
          if (typeof parsed === "object" && parsed !== null && "count" in parsed) {
            const count = (parsed as { count: unknown }).count;
            if (typeof count === "number" && count >= 0) return count;
          }
          return 0;
        },
      });

      expect(store.get()).toBe(42);
    });

    it("returns fallback if validate throws", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify({ invalid: true }));
      const store = createLocalStore<string>({
        key: TEST_KEY,
        fallback: "safe",
        validate: () => {
          throw new Error("Validation exploded");
        },
      });

      expect(store.get()).toBe("safe");
    });
  });

  describe("write and remove behavior", () => {
    it("persists serialized value to localStorage and dispatches change event", () => {
      const listener = vi.fn();
      window.addEventListener(CHANGE_EVENT, listener);

      const store = createLocalStore<{ active: boolean }>({
        key: TEST_KEY,
        changeEvent: CHANGE_EVENT,
        fallback: { active: false },
      });

      store.set({ active: true });

      expect(window.localStorage.getItem(TEST_KEY)).toBe(JSON.stringify({ active: true }));
      expect(listener).toHaveBeenCalledTimes(1);

      window.removeEventListener(CHANGE_EVENT, listener);
    });

    it("removes key from localStorage and dispatches change event on remove()", () => {
      window.localStorage.setItem(TEST_KEY, JSON.stringify("to_be_removed"));
      const listener = vi.fn();
      window.addEventListener(CHANGE_EVENT, listener);

      const store = createLocalStore<string>({
        key: TEST_KEY,
        changeEvent: CHANGE_EVENT,
        fallback: "none",
      });

      store.remove();

      expect(window.localStorage.getItem(TEST_KEY)).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(store.get()).toBe("none");

      window.removeEventListener(CHANGE_EVENT, listener);
    });

    it("catches quota exceeded errors gracefully during set()", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      });

      const store = createLocalStore<string>({
        key: TEST_KEY,
        fallback: "fallback",
      });

      expect(() => store.set("too_big")).not.toThrow();
    });

    it("catches storage errors gracefully during remove()", () => {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new DOMException("SecurityError", "SecurityError");
      });

      const store = createLocalStore<string>({
        key: TEST_KEY,
        fallback: "fallback",
      });

      expect(() => store.remove()).not.toThrow();
    });
  });

  describe("subscription behavior", () => {
    it("notifies subscriber on same-tab change event", () => {
      const store = createLocalStore<string>({
        key: TEST_KEY,
        changeEvent: CHANGE_EVENT,
        fallback: "",
      });

      const callback = vi.fn();
      const unsubscribe = store.subscribe(callback);

      store.set("updated");
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      store.set("updated_again");
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("notifies subscriber on cross-tab storage event for the same key", () => {
      const store = createLocalStore<string>({
        key: TEST_KEY,
        fallback: "",
      });

      const callback = vi.fn();
      const unsubscribe = store.subscribe(callback);

      // Storage event for matching key
      window.dispatchEvent(new StorageEvent("storage", { key: TEST_KEY }));
      expect(callback).toHaveBeenCalledTimes(1);

      // Storage event when entire storage is cleared (key === null)
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      expect(callback).toHaveBeenCalledTimes(2);

      // Storage event for different key should NOT notify
      window.dispatchEvent(new StorageEvent("storage", { key: "some_unrelated_key" }));
      expect(callback).toHaveBeenCalledTimes(2);

      unsubscribe();
    });
  });

  describe("useSyncExternalStore snapshot caching", () => {
    it("maintains referential stability across repeated getSnapshot() calls without change", () => {
      const store = createLocalStore<{ items: string[] }>({
        key: TEST_KEY,
        fallback: { items: [] },
        validate: (parsed) => parsed as { items: string[] },
      });

      store.set({ items: ["a", "b"] });

      const snap1 = store.getSnapshot();
      const snap2 = store.getSnapshot();

      // Must be referentially identical to prevent React render loops
      expect(snap1).toBe(snap2);
    });

    it("updates snapshot reference when storage value changes", () => {
      const store = createLocalStore<{ count: number }>({
        key: TEST_KEY,
        fallback: { count: 0 },
        validate: (parsed) => parsed as { count: number },
      });

      store.set({ count: 1 });
      const snap1 = store.getSnapshot();
      expect(snap1).toEqual({ count: 1 });

      store.set({ count: 2 });
      const snap2 = store.getSnapshot();
      expect(snap2).toEqual({ count: 2 });
      expect(snap1).not.toBe(snap2);
    });

    it("returns fallback reference when cleared", () => {
      const store = createLocalStore<string[]>({
        key: TEST_KEY,
        fallback: [],
        validate: (parsed) => (Array.isArray(parsed) ? parsed : []),
      });

      store.set(["x", "y"]);
      expect(store.getSnapshot()).toEqual(["x", "y"]);

      store.remove();
      expect(store.getSnapshot()).toEqual([]);
    });
  });

  describe("ranking-preference store integration", () => {
    it("defaults to null on clean storage or corrupt JSON", () => {
      expect(getRankingPreference()).toBeNull();
      expect(getRankingPreferenceSnapshot()).toBeNull();
      expect(getRankingPreferenceServerSnapshot()).toBeNull();

      window.localStorage.setItem("coffeemode:search_ranking:v1", "invalid_enum");
      expect(getRankingPreference()).toBeNull();
    });

    it("stores and reads valid preference values with pub/sub notifications", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeRankingPreference(listener);

      setRankingPreference("good_first");
      expect(getRankingPreference()).toBe("good_first");
      expect(getRankingPreferenceSnapshot()).toBe("good_first");
      expect(listener).toHaveBeenCalledTimes(1);

      setRankingPreference("relevance");
      expect(getRankingPreference()).toBe("relevance");
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
    });
  });

  describe("recent-searches store integration", () => {
    it("preserves read-path cap when storage exceeds max (BRAWUKA-451)", () => {
      // Overpopulate localStorage beyond default cap of 20
      const items = Array.from({ length: 30 }, (_, i) => ({
        id: `item-${i}`,
        query: `query-${i}`,
        city: "tokyo",
        timestamp: 1000 + i,
      }));
      window.localStorage.setItem("coffeemode:recent_searches:v1", JSON.stringify(items));

      const searches = getRecentSearches();
      expect(searches).toHaveLength(20);
      expect(searches[0].id).toBe("item-0");
      expect(getRecentSearchesSnapshot()).toEqual(searches);
      expect(getRecentSearchesServerSnapshot()).toEqual([]);
    });

    it("adds items, deduplicates case-insensitively, and notifies subscribers", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeRecentSearches(listener);

      addRecentSearch("coffee", "tokyo");
      expect(getRecentSearches()).toHaveLength(1);
      expect(getRecentSearches()[0].query).toBe("coffee");
      expect(listener).toHaveBeenCalledTimes(1);

      // Re-add case-insensitively deduplicates
      addRecentSearch("COFFEE", "TOKYO");
      expect(getRecentSearches()).toHaveLength(1);
      expect(listener).toHaveBeenCalledTimes(2);

      clearRecentSearches();
      expect(getRecentSearches()).toEqual([]);
      expect(listener).toHaveBeenCalledTimes(3);

      unsubscribe();
    });
  });

  describe("onboarding-store integration", () => {
    it("returns null initially and merges partial writes", () => {
      expect(readOnboardingState()).toBeNull();

      const listener = vi.fn();
      const unsubscribe = subscribeOnboardingStore(listener);

      writeOnboardingState({ onboarded: true });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(readOnboardingState()).toEqual({
        onboarded: true,
        currentCity: null,
        currentCityName: null,
        lastLocation: null,
      });

      unsubscribe();

      writeOnboardingState({
        currentCity: "tokyo",
        currentCityName: "Tokyo",
        lastLocation: { lat: 35.6895, lng: 139.6917 },
      });

      expect(readOnboardingState()).toEqual({
        onboarded: true,
        currentCity: "tokyo",
        currentCityName: "Tokyo",
        lastLocation: { lat: 35.6895, lng: 139.6917 },
      });
    });

    it("validates coordinates shape and bounds", () => {
      window.localStorage.setItem(
        "coffeemode:onboarding:v1",
        JSON.stringify({
          onboarded: true,
          lastLocation: { lat: 999, lng: 999 }, // out of range
        }),
      );

      expect(readOnboardingState()).toEqual({
        onboarded: true,
        currentCity: null,
        currentCityName: null,
        lastLocation: null,
      });
    });

    it("tracks locate settings toast shown flag", () => {
      expect(hasShownLocateSettingsToast()).toBe(false);
      markLocateSettingsToastShown();
      expect(hasShownLocateSettingsToast()).toBe(true);
    });
  });
});
