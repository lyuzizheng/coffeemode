import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSearch, resolveReferencePoint } from "@/lib/search/search-service";
import { searchCafesInDb } from "@/lib/db/search";
import { searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import type { CafeWithExternalIds } from "@/lib/db/search";
import type { POI } from "@shared/places/types";

vi.mock("@/lib/db/search", () => ({
  searchCafesInDb: vi.fn(),
}));

vi.mock("@/lib/places/poi-client", () => ({
  searchPOIs: vi.fn(),
  searchExternalPOIs: vi.fn(),
}));

function makeDbCafe(overrides?: Partial<CafeWithExternalIds>): CafeWithExternalIds {
  return {
    id: "cafe-1",
    name: "Nylon Coffee Roasters",
    lat: 1.275,
    lng: 103.84,
    address: "Everton Park",
    city: "singapore",
    tz: "Asia/Singapore",
    opening_hours: null,
    price_range: 2,
    cover: null,
    google_place_id: "gplace_123",
    apple_poi_id: null,
    work_stats: emptyWorkStats(),
    ...overrides,
  };
}

function makePoi(overrides?: Partial<POI>): POI {
  return {
    place_id: "gplace_456",
    source: "google",
    name: "Chye Seng Huat Hardware",
    lat: 1.311,
    lng: 103.86,
    address: "Tyrwhitt Rd",
    types: ["cafe", "food"],
    business_status: "OPERATIONAL",
    hours_json: null,
    photo_refs: [],
    fetched_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

describe("search-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges own cafes and saved POIs, deduplicating by place_id (DG45)", async () => {
    const cafe1 = makeDbCafe({ id: "c1", name: "Nylon Coffee Roasters", google_place_id: "shared_id" });
    const poi1 = makePoi({ place_id: "shared_id", name: "Nylon Stored POI" });
    const poi2 = makePoi({ place_id: "distinct_id", name: "Distinct POI" });

    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1]);
    vi.mocked(searchPOIs).mockResolvedValue({ results: [poi1, poi2] });

    const response = await executeSearch({ q: "Nylon", city: "singapore" });

    // c1 wins over poi1 because they share place_id "shared_id", and c1 ranks first due to name relevance
    expect(response.results).toHaveLength(2);
    expect(response.results[0].id).toBe("c1");
    expect(response.results[0].type).toBe("cafe");
    expect(response.results[0].source).toBe("coffeemode");
    expect(response.results[1].id).toBe("distinct_id");
    expect(response.results[1].type).toBe("poi");
    expect(response.results[1].source).toBe("google");
  });

  it("fetches live external POIs when include_live=true and merges them", async () => {
    const cafe1 = makeDbCafe({ id: "c1", name: "Local Cafe" });
    const storedPoi = makePoi({ place_id: "stored_pid", name: "Stored POI" });
    const livePoi = makePoi({ place_id: "live_pid", name: "Live Google POI", source: "google" });

    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1]);
    vi.mocked(searchPOIs).mockResolvedValue({ results: [storedPoi] });
    vi.mocked(searchExternalPOIs).mockResolvedValue({ results: [livePoi] });

    const response = await executeSearch({ q: "coffee", include_live: true });

    expect(searchExternalPOIs).toHaveBeenCalledWith(
      expect.objectContaining({ q: "coffee" }),
    );
    expect(response.results).toHaveLength(3);
    const liveResult = response.results.find((r) => r.id === "live_pid");
    expect(liveResult).toBeDefined();
    expect(liveResult?.source).toBe("google");
  });

  it("handles unknown city without silently re-anchoring to Singapore (DG58)", async () => {
    const cafe1 = makeDbCafe({ id: "c1", name: "Paris Cafe", city: "paris", lat: 48.85, lng: 2.35 });
    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1]);

    const ref = resolveReferencePoint(undefined, undefined, "paris");
    expect(ref.lat).toBeNull();
    expect(ref.lng).toBeNull();
    expect(ref.is_from_city_center).toBe(false);

    const response = await executeSearch({ city: "paris" });
    expect(response.reference_point.lat).toBeNull();
    expect(response.results[0].distance_m).toBeNull();
    expect(response.results[0].is_from_city_center).toBe(false);
  });

  it("flags weak results when total count < 3 (DG49)", async () => {
    const cafe1 = makeDbCafe({ id: "c1", name: "Single Match" });
    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1]);
    vi.mocked(searchPOIs).mockResolvedValue({ results: [] });

    const response = await executeSearch({ q: "single" });

    expect(response.total_count).toBe(1);
    expect(response.is_weak_results).toBe(true);
  });

  it("flags non-weak results when total count >= 3", async () => {
    const cafe1 = makeDbCafe({ id: "c1", name: "Cafe 1" });
    const cafe2 = makeDbCafe({ id: "c2", name: "Cafe 2" });
    const cafe3 = makeDbCafe({ id: "c3", name: "Cafe 3" });
    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1, cafe2, cafe3]);
    vi.mocked(searchPOIs).mockResolvedValue({ results: [] });

    const response = await executeSearch({ q: "cafe" });

    expect(response.total_count).toBe(3);
    expect(response.is_weak_results).toBe(false);
  });

  it("uses city center distance when user coordinates are omitted (DG58)", async () => {
    const cafe1 = makeDbCafe({ id: "c1", name: "Cafe 1", lat: 1.35, lng: 103.8 });
    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1]);
    vi.mocked(searchPOIs).mockResolvedValue({ results: [] });

    const response = await executeSearch({ city: "singapore" });

    expect(response.reference_point.is_from_city_center).toBe(true);
    expect(response.reference_point.city_id).toBe("singapore");
    expect(response.results[0].is_from_city_center).toBe(true);
    expect(response.results[0].distance_m).toBeDefined();
  });

  it("uses user coordinates when provided (DG58)", async () => {
    const cafe1 = makeDbCafe({ id: "c1", name: "Cafe 1", lat: 1.35, lng: 103.8 });
    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1]);
    vi.mocked(searchPOIs).mockResolvedValue({ results: [] });

    const response = await executeSearch({ lat: 1.35, lng: 103.8 });

    expect(response.reference_point.is_from_city_center).toBe(false);
    expect(response.results[0].is_from_city_center).toBe(false);
  });

  it("excludes saved POIs when nomad work filters are active", async () => {
    const stats = emptyWorkStats();
    stats.dims.wifi = { sum: 90, n: 1 };
    const cafe1 = makeDbCafe({ id: "c1", name: "Fast Wifi Cafe", work_stats: stats });
    const poi1 = makePoi({ place_id: "poi_1", name: "Random POI" });

    vi.mocked(searchCafesInDb).mockResolvedValue([cafe1]);
    vi.mocked(searchPOIs).mockResolvedValue({ results: [poi1] });

    const response = await executeSearch({ filter_wifi: 80 });

    expect(searchPOIs).not.toHaveBeenCalled();
    expect(searchCafesInDb).toHaveBeenCalledWith(
      expect.objectContaining({
        filter_wifi: 80,
      }),
    );
    expect(response.results).toHaveLength(1);
    expect(response.results[0].type).toBe("cafe");
  });

  it("passes all work dimension filters and max_stay to searchCafesInDb for SQL pushdown", async () => {
    vi.mocked(searchCafesInDb).mockResolvedValue([]);

    await executeSearch({
      city: "singapore",
      filter_wifi: 70,
      filter_outlets: 60,
      filter_seats: 50,
      filter_temp: 40,
      filter_coffee: 80,
      filter_overall: 75,
      filter_max_stay: "2h",
    });

    expect(searchCafesInDb).toHaveBeenCalledWith({
      q: undefined,
      city: "singapore",
      filter_wifi: 70,
      filter_outlets: 60,
      filter_seats: 50,
      filter_temp: 40,
      filter_coffee: 80,
      filter_overall: 75,
      filter_max_stay: "2h",
      limit: expect.any(Number),
    });
  });

  it("performs bounded iterative fetching across batches when open_now filter is active", async () => {
    // Batch 1 (offset 0): 100 cafes, all closed
    const batch1 = Array.from({ length: 100 }, (_, i) =>
      makeDbCafe({
        id: `closed-${i}`,
        name: `Alpha Closed ${i.toString().padStart(3, "0")}`,
        opening_hours: null,
      }),
    );

    // Batch 2 (offset 100): 20 cafes, all open
    const alwaysOpenHours = {
      mon: { open: "00:00", close: "23:59" },
      tue: { open: "00:00", close: "23:59" },
      wed: { open: "00:00", close: "23:59" },
      thu: { open: "00:00", close: "23:59" },
      fri: { open: "00:00", close: "23:59" },
      sat: { open: "00:00", close: "23:59" },
      sun: { open: "00:00", close: "23:59" },
    };
    const batch2 = Array.from({ length: 20 }, (_, i) =>
      makeDbCafe({
        id: `open-${i}`,
        name: `Zulu Open ${i.toString().padStart(3, "0")}`,
        opening_hours: alwaysOpenHours,
      }),
    );

    vi.mocked(searchCafesInDb).mockImplementation(async (params) => {
      if ((params.offset ?? 0) === 0) return batch1;
      if (params.offset === 100) return batch2;
      return [];
    });

    const response = await executeSearch(
      { city: "singapore", open_now: true },
      new Date("2026-08-29T10:00:00Z"),
    );

    expect(searchCafesInDb).toHaveBeenCalledTimes(2);
    expect(searchCafesInDb).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ offset: 0, limit: 100 }),
    );
    expect(searchCafesInDb).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ offset: 100, limit: 100 }),
    );
    expect(response.results).toHaveLength(10);
    expect(response.results.every((r) => r.id.startsWith("open-"))).toBe(true);
  });

  it("stops iterative fetching early once enough open results are collected", async () => {
    const alwaysOpenHours = {
      mon: { open: "00:00", close: "23:59" },
      tue: { open: "00:00", close: "23:59" },
      wed: { open: "00:00", close: "23:59" },
      thu: { open: "00:00", close: "23:59" },
      fri: { open: "00:00", close: "23:59" },
      sat: { open: "00:00", close: "23:59" },
      sun: { open: "00:00", close: "23:59" },
    };
    const batch1 = Array.from({ length: 100 }, (_, i) =>
      makeDbCafe({
        id: `open-batch1-${i}`,
        name: `Alpha Open ${i.toString().padStart(3, "0")}`,
        opening_hours: alwaysOpenHours,
      }),
    );

    vi.mocked(searchCafesInDb).mockResolvedValue(batch1);

    const response = await executeSearch(
      { city: "singapore", open_now: true, limit: 5 },
      new Date("2026-08-29T10:00:00Z"),
    );

    expect(searchCafesInDb).toHaveBeenCalledTimes(1);
    expect(response.results).toHaveLength(5);
  });
});
