import { describe, expect, it } from "vitest";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import type { CafeSummary } from "@/types/cafes";
import {
  acceptableMaxStayLabels,
  getConsensusOption,
  getDimensionAverage,
  hasWorkFiltersActive,
  matchesAllFilters,
  matchesMaxStay,
  matchesWorkDimension,
} from "@/lib/search/filter";

function makeCafe(overrides?: Partial<CafeSummary>): CafeSummary {
  return {
    id: "cafe-1",
    name: "Test Cafe",
    lat: 1.35,
    lng: 103.8,
    address: "123 Orchard Rd",
    city: "singapore",
    tz: "Asia/Singapore",
    opening_hours: {
      mon: { open: "08:00", close: "20:00" },
      tue: { open: "08:00", close: "20:00" },
      wed: { open: "08:00", close: "20:00" },
      thu: { open: "08:00", close: "20:00" },
      fri: { open: "08:00", close: "20:00" },
      sat: { open: "08:00", close: "20:00" },
      sun: { open: "08:00", close: "20:00" },
    },
    price_range: 2,
    cover: null,
    work_stats: emptyWorkStats(),
    ...overrides,
  };
}

describe("search/filter helpers", () => {
  it("computes dimension averages correctly", () => {
    const stats = emptyWorkStats();
    expect(getDimensionAverage(stats, "wifi")).toBeNull();

    stats.dims.wifi = { sum: 160, n: 2 };
    expect(getDimensionAverage(stats, "wifi")).toBe(80);

    stats.experience_score = 85;
    expect(getDimensionAverage(stats, "overall")).toBe(85);
  });

  it("evaluates work dimension thresholds", () => {
    const stats = emptyWorkStats();
    stats.dims.wifi = { sum: 75, n: 1 };
    stats.dims.outlets = { sum: 50, n: 1 };

    expect(matchesWorkDimension(stats, "wifi", 60)).toBe(true);
    expect(matchesWorkDimension(stats, "wifi", 80)).toBe(false);
    expect(matchesWorkDimension(stats, "outlets", 60)).toBe(false);
    expect(matchesWorkDimension(stats, "seats", 60)).toBe(false); // no data
  });

  it("evaluates ordinal consensus policies for max_stay", () => {
    expect(getConsensusOption({})).toBeNull();
    expect(getConsensusOption({ unlimited: 3, "3h": 1 })).toBe("unlimited");

    const stats = emptyWorkStats();
    // Cafe allows 3h stay
    stats.policies.max_stay = { "3h": 4, unlimited: 1 };

    // Ordinal max_stay: lower bound desired stay
    expect(matchesMaxStay(stats, "1h")).toBe(true); // 3h >= 1h
    expect(matchesMaxStay(stats, "2h")).toBe(true); // 3h >= 2h
    expect(matchesMaxStay(stats, "3h")).toBe(true); // 3h >= 3h
    expect(matchesMaxStay(stats, "unlimited")).toBe(false); // 3h < unlimited
  });

  it("derives acceptable max stay labels consistently with MAX_STAY_ORDER", () => {
    expect(acceptableMaxStayLabels("peak")).toEqual(["peak"]);
    expect(acceptableMaxStayLabels("1h")).toEqual(["1h", "2h", "3h", "unlimited"]);
    expect(acceptableMaxStayLabels("2h")).toEqual(["2h", "3h", "unlimited"]);
    expect(acceptableMaxStayLabels("3h")).toEqual(["3h", "unlimited"]);
    expect(acceptableMaxStayLabels("unlimited")).toEqual(["unlimited"]);
    expect(acceptableMaxStayLabels("unknown")).toEqual([
      "unknown",
      "peak",
      "1h",
      "2h",
      "3h",
      "unlimited",
    ]);
  });

  it("checks if any work filters are active", () => {
    expect(hasWorkFiltersActive({})).toBe(false);
    expect(hasWorkFiltersActive({ filter_wifi: 60 })).toBe(true);
    expect(hasWorkFiltersActive({ filter_max_stay: "2h" })).toBe(true);
    expect(hasWorkFiltersActive({ open_now: true })).toBe(false);
  });

  it("filters cafe matching all criteria", () => {
    const stats = emptyWorkStats();
    stats.dims.wifi = { sum: 85, n: 1 };
    stats.dims.outlets = { sum: 90, n: 1 };
    stats.policies.max_stay = { unlimited: 3 };

    const cafe = makeCafe({ work_stats: stats });

    expect(matchesAllFilters(cafe, { filter_wifi: 80, filter_outlets: 60 })).toBe(true);
    expect(matchesAllFilters(cafe, { filter_wifi: 90 })).toBe(false);
    expect(matchesAllFilters(cafe, { filter_max_stay: "unlimited" })).toBe(true);
    expect(matchesAllFilters(cafe, { filter_max_stay: "peak" })).toBe(false);
  });
});
