import { beforeEach, describe, expect, it, vi } from "vitest";
import { cafesDataVersion } from "@/lib/db/search";
import {
  clearSearchCache,
  executeSearchCached,
  searchCacheKey,
} from "@/lib/search/search-cache";
import { executeSearch } from "@/lib/search/search-service";
import type { SearchServiceResponse } from "@/lib/search/types";

vi.mock("@/lib/db/search", () => ({
  cafesDataVersion: vi.fn(),
}));

vi.mock("@/lib/search/search-service", () => ({
  emitSearchTelemetry: vi.fn(),
  executeSearch: vi.fn(),
}));

const baseResponse: SearchServiceResponse = {
  results: [],
  total_count: 0,
  is_weak_results: false,
  reference_point: { lat: null, lng: null, is_from_city_center: false },
  search_mode: "stored_only",
};

describe("searchCacheKey open_now bucketing (BRAWUKA-570)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSearchCache();
  });

  it("scopes open_now keys to the UTC minute", () => {
    const t0 = Date.UTC(2026, 8, 21, 9, 59, 30);
    const sameMinute = Date.UTC(2026, 8, 21, 9, 59, 55);
    const nextMinute = Date.UTC(2026, 8, 21, 10, 0, 5);
    const filters = { city: "singapore", open_now: true as const };

    expect(searchCacheKey(filters, sameMinute)).toBe(searchCacheKey(filters, t0));
    expect(searchCacheKey(filters, nextMinute)).not.toBe(searchCacheKey(filters, t0));
  });

  it("leaves non-open_now keys byte-identical across minutes", () => {
    const t0 = Date.UTC(2026, 8, 21, 9, 59, 30);
    const nextMinute = Date.UTC(2026, 8, 21, 10, 0, 5);
    const filters = { city: "singapore" };

    expect(searchCacheKey(filters, nextMinute)).toBe(searchCacheKey(filters, t0));
    expect(searchCacheKey(filters, t0)).not.toContain(":m");
  });

  it("re-evaluates an open_now fill after the minute boundary", async () => {
    vi.mocked(cafesDataVersion).mockResolvedValue("v1");
    vi.mocked(executeSearch).mockResolvedValue(baseResponse);
    const filters = { city: "singapore", open_now: true as const };
    // +40s later crosses into the next UTC minute but stays inside the 60s
    // TTL — so a miss there proves bucketing, not TTL expiry.
    const t0 = Date.UTC(2026, 8, 21, 9, 59, 30);

    expect((await executeSearchCached(filters, t0)).cache).toBe("miss");
    expect((await executeSearchCached(filters, t0 + 10_000)).cache).toBe("hit");
    // Past the boundary the old entry must not serve: miss + a fresh fill.
    expect((await executeSearchCached(filters, t0 + 40_000)).cache).toBe("miss");
    expect(vi.mocked(executeSearch)).toHaveBeenCalledTimes(2);
  });

  it("keeps serving non-open_now entries across the minute boundary", async () => {
    vi.mocked(cafesDataVersion).mockResolvedValue("v1");
    vi.mocked(executeSearch).mockResolvedValue(baseResponse);
    const filters = { city: "singapore" };
    const t0 = Date.UTC(2026, 8, 21, 9, 59, 30);

    expect((await executeSearchCached(filters, t0)).cache).toBe("miss");
    expect((await executeSearchCached(filters, t0 + 40_000)).cache).toBe("hit");
    expect(vi.mocked(executeSearch)).toHaveBeenCalledTimes(1);
  });
});
