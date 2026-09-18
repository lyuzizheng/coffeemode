import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  EMPTY_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  hasActiveFilters,
} from "@/lib/search/search-filters";

describe("search filter state (DG44–DG58)", () => {
  it("empty state emits no params and counts zero", () => {
    const params = new URLSearchParams();
    filtersToSearchParams(EMPTY_FILTERS, params);
    expect(params.toString()).toBe("");
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("round-trips open_now, dim thresholds, and max_stay", () => {
    const state = {
      openNow: true,
      thresholds: { wifi: 60 as const, coffee: 80 as const },
      maxStay: "2h" as const,
    };
    const params = new URLSearchParams();
    filtersToSearchParams(state, params);
    expect(params.get("open_now")).toBe("true");
    expect(params.get("filter_wifi")).toBe("60");
    expect(params.get("filter_coffee")).toBe("80");
    expect(params.get("filter_max_stay")).toBe("2h");
    expect(params.get("filter_seats")).toBeNull();
    expect(filtersFromSearchParams(params)).toEqual(state);
    expect(countActiveFilters(state)).toBe(4);
  });

  it("drops unrepresentable URL values instead of lying about control position", () => {
    const params = new URLSearchParams(
      "filter_wifi=63&filter_max_stay=unknown&open_now=1&filter_outlets=80",
    );
    const state = filtersFromSearchParams(params);
    // 63 is a valid API score but not a tri-state position — it must not
    // decode into a segment the UI cannot display.
    expect(state.thresholds.wifi).toBeUndefined();
    expect(state.thresholds.outlets).toBe(80);
    // `unknown` is never offered as a max-stay filter (spec §4).
    expect(state.maxStay).toBeNull();
    // Only the literal "true" activates open_now.
    expect(state.openNow).toBe(false);
  });
});
