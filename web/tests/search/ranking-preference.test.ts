import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRankingPreference,
  setRankingPreference,
} from "@/lib/search/ranking-preference";

const STORAGE_KEY = "coffeemode:search_ranking:v1";

describe("ranking-preference helper (DG136)", () => {
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

  it("returns null when unset, so callers omit ?ranking= (server default)", () => {
    expect(getRankingPreference()).toBeNull();
  });

  it("round-trips a chosen preference", () => {
    setRankingPreference("good_first");
    expect(getRankingPreference()).toBe("good_first");
    setRankingPreference("relevance");
    expect(getRankingPreference()).toBe("relevance");
  });

  it("rejects malformed or unknown stored values", () => {
    store[STORAGE_KEY] = "not json";
    expect(getRankingPreference()).toBeNull();
    store[STORAGE_KEY] = JSON.stringify("nearest_first");
    expect(getRankingPreference()).toBeNull();
  });

  it("survives quota errors on write without throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(() => setRankingPreference("good_first")).not.toThrow();
  });
});
