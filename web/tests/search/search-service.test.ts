import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSearch } from "@/lib/search/search-service";
import { searchCafesInDb } from "@/lib/db/search";
import { searchPOIs } from "@/lib/places/poi-client";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import type { CafeWithExternalIds } from "@/lib/db/search";
import type { POI } from "@shared/places/types";

vi.mock("@/lib/db/search", () => ({
  searchCafesInDb: vi.fn(),
}));

vi.mock("@/lib/places/poi-client", () => ({
  searchPOIs: vi.fn(),
}));

function makeDbCafe(overrides?: Partial<CafeWithExternalIds>): CafeWithExternalIds {
  return {
    id: "cafe-1",
    slug: "nylon-coffee",
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
    expect(response.results[1].id).toBe("poi_distinct_id");
    expect(response.results[1].type).toBe("poi");
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
    expect(response.results).toHaveLength(1);
    expect(response.results[0].type).toBe("cafe");
  });
});
