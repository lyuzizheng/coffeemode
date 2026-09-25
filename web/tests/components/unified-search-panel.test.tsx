import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedSearchPanel } from "@/components/search/unified-search-panel";
import type { UnifiedSearchParams } from "@/lib/search/search-client";
import {
  EMPTY_FILTERS,
  type SearchFilterState,
} from "@/lib/search/search-filters";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import en from "@/messages/en.json";


function makeResponse(names: string[]): SearchResponse {
  const results: SearchResultItem[] = names.map((name) => ({
    id: `id-${name}`,
    type: "cafe",
    source: "coffeemode",
    name,
    address: "Somewhere",
    lat: 1.3,
    lng: 103.8,
    distance_m: 1200,
    is_from_city_center: false,
  }));
  return {
    results,
    total_count: results.length,
    is_weak_results: false,
    reference_point: { lat: 1.3, lng: 103.8, is_from_city_center: false },
  };
}

interface TestHarnessProps {
  fetchSearch: (params: UnifiedSearchParams) => Promise<SearchResponse>;
  initialFilters?: SearchFilterState;
  initialQuery?: string;
}

function TestHarness({
  fetchSearch,
  initialFilters = EMPTY_FILTERS,
  initialQuery = "",
}: TestHarnessProps) {
  const [filters, setFilters] = useState<SearchFilterState>(initialFilters);
  const [query, setQuery] = useState(initialQuery);

  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <button
        data-testid="set-filter-wifi"
        onClick={() =>
          setFilters({
            openNow: false,
            thresholds: { wifi: 80 },
            maxStay: null,
          })
        }
      >
        Set Wifi Filter
      </button>
      <button
        data-testid="clear-filters"
        onClick={() => setFilters(EMPTY_FILTERS)}
      >
        Clear Filters
      </button>
      <UnifiedSearchPanel
        query={query}
        onQueryChange={setQuery}
        city="singapore"
        filters={filters}
        onFiltersChange={setFilters}
        fetchSearch={fetchSearch}
        externalSources={{ google: true, apple: false }}
        mapkitConfigured={false}
        onSelectResult={() => {}}
        onExternalSearch={() => {}}
      />
    </NextIntlClientProvider>
  );
}

describe("UnifiedSearchPanel browse-mode filter OFF regression (BRAWUKA-716)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refetches search when nomad filters toggle back to Any in empty-query browse mode", async () => {
    const fetchSearch = vi.fn(async (params: UnifiedSearchParams) => {
      if (params.filters?.thresholds?.wifi === 80) return makeResponse(["Filtered Cafe"]);
      return makeResponse(["Baseline Cafe 1", "Baseline Cafe 2"]);
    });

    render(<TestHarness fetchSearch={fetchSearch} />);

    // Initially query is "" and filters are empty -> idle, no search fired.
    expect(fetchSearch).not.toHaveBeenCalled();

    // 1. User sets Wifi 80+ in browse mode (query is still "").
    await act(async () => {
      fireEvent.click(screen.getByTestId("set-filter-wifi"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(fetchSearch).toHaveBeenCalledTimes(1);
    expect(fetchSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: "",
        city: "singapore",
        filters: expect.objectContaining({ thresholds: { wifi: 80 } }),
      }),
    );

    // 2. User switches Wifi back to "Any" (clearing active filters, query remains "").
    // BRAWUKA-716: browseActive latches browse mode so wantsResults remains true and
    // triggers a refetch of the baseline search with q: "" and EMPTY_FILTERS.
    await act(async () => {
      fireEvent.click(screen.getByTestId("clear-filters"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(fetchSearch).toHaveBeenCalledTimes(2);
    expect(fetchSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: "",
        city: "singapore",
        filters: EMPTY_FILTERS,
      }),
    );
  });

  it("sub-min query does not trigger search when browseActive was latched (DG44)", async () => {
    const fetchSearch = vi.fn(async () => makeResponse(["Cafe"]));

    render(<TestHarness fetchSearch={fetchSearch} />);

    // Latch browse mode by setting filter then clearing filter.
    await act(async () => {
      fireEvent.click(screen.getByTestId("set-filter-wifi"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId("clear-filters"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(2);

    // Now user types a 1-character query ("a"):
    // Typing text leaves empty-query browse mode; sub-min query must NOT trigger search.
    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "a" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // fetchSearch should NOT have been called a 3rd time for "a"
    expect(fetchSearch).toHaveBeenCalledTimes(2);
  });

  it("Escape key dismisses latched browseActive state and returns panel to idle", async () => {
    const fetchSearch = vi.fn(async () => makeResponse(["Cafe"]));

    render(<TestHarness fetchSearch={fetchSearch} />);

    // 1. Set filter in browse mode.
    await act(async () => {
      fireEvent.click(screen.getByTestId("set-filter-wifi"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(1);

    // 2. Clear filter: refetches baseline and stays in latched browse mode.
    await act(async () => {
      fireEvent.click(screen.getByTestId("clear-filters"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(2);

    // 3. Press Escape: dismisses browse mode and returns to idle.
    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // No new search fired; search count remains 2.
    expect(fetchSearch).toHaveBeenCalledTimes(2);
  });

  it("closing filter surface without active filters resets latched browseActive state", async () => {
    const fetchSearch = vi.fn(async () => makeResponse(["Cafe"]));

    render(<TestHarness fetchSearch={fetchSearch} />);

    const filterBtn = screen.getByRole("button", { name: "Filters" });
    // 1. Open filter panel.
    await act(async () => {
      fireEvent.click(filterBtn);
    });

    // 2. Set filter in browse mode.
    await act(async () => {
      fireEvent.click(screen.getByTestId("set-filter-wifi"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(1);

    // 3. Clear filters (recovering baseline, latched in browse mode).
    await act(async () => {
      fireEvent.click(screen.getByTestId("clear-filters"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(2);

    // 4. Close filter panel via FilterButton:
    // With !filtersActive and query < MIN_QUERY_LENGTH, handleFilterOpenChange resets browseActive.
    await act(async () => {
      fireEvent.click(filterBtn);
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Panel is now reset to idle, no extra search fired.
    expect(fetchSearch).toHaveBeenCalledTimes(2);
  });

  it("clearing text query resets browseActive and returns panel to idle", async () => {
    const fetchSearch = vi.fn(async () => makeResponse(["Cafe"]));

    render(<TestHarness fetchSearch={fetchSearch} />);

    // 1. Set filter then clear filter (browseActive latched).
    await act(async () => {
      fireEvent.click(screen.getByTestId("set-filter-wifi"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("clear-filters"));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(2);

    // 2. Type text query (>= MIN_QUERY_LENGTH).
    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "coffee" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(fetchSearch).toHaveBeenCalledTimes(3);

    // 3. Clear text query back to "".
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // queryWasCleared && !filtersActive resets browseActive to false and status to idle!
    // No new search fired.
    expect(fetchSearch).toHaveBeenCalledTimes(3);
  });
});
