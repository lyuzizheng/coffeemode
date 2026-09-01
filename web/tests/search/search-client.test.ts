import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRankingPreference } from "@/lib/search/ranking-preference";
import { fetchUnifiedSearch } from "@/lib/search/search-client";
import type { SearchResponse } from "@/lib/search/types";

const EMPTY_RESPONSE: SearchResponse = {
  results: [],
  total_count: 0,
  is_weak_results: true,
  reference_point: { lat: null, lng: null, is_from_city_center: false },
};

describe("fetchUnifiedSearch", () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(EMPTY_RESPONSE), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requestedUrl(): string {
    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(call).toBeDefined();
    return String(call?.[0]);
  }

  it("omits ?ranking= when the user never chose (server default applies)", async () => {
    await fetchUnifiedSearch({ q: "coffee" });
    expect(requestedUrl()).not.toContain("ranking=");
  });

  it("appends ?ranking=good_first once the toggle is set (DG136)", async () => {
    setRankingPreference("good_first");
    await fetchUnifiedSearch({ q: "coffee", city: "tokyo" });
    const url = requestedUrl();
    expect(url).toContain("ranking=good_first");
    expect(url).toContain("q=coffee");
    expect(url).toContain("city=tokyo");
  });

  it("appends ?ranking=relevance when explicitly chosen", async () => {
    setRankingPreference("relevance");
    await fetchUnifiedSearch({ q: "coffee" });
    expect(requestedUrl()).toContain("ranking=relevance");
  });

  it("throws with the server message on non-OK responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    await expect(fetchUnifiedSearch({ q: "coffee" })).rejects.toThrow("boom");
  });
});
