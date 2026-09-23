import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
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

type FetchSearch = (params: UnifiedSearchParams) => Promise<SearchResponse>;

function deferred<T>() {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
}

describe("UnifiedSearchPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderPanel(fetchSearch: FetchSearch) {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <UnifiedSearchPanel
          externalSources={{ google: true, apple: false }}
          mapkitConfigured={false}
          onSelectResult={() => {}}
          onExternalSearch={() => {}}
          fetchSearch={fetchSearch}
        />
      </NextIntlClientProvider>,
    );
    return screen.getByPlaceholderText("Search cafes, neighborhoods, or addresses");
  }

  const type = (input: HTMLElement, value: string) =>
    fireEvent.change(input, { target: { value } });

  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  it("never searches below 3 characters (DG44)", async () => {
    const fetchSearch = vi.fn(() => deferred<SearchResponse>().promise);
    const input = renderPanel(fetchSearch);

    type(input, "ab");
    await advance(1000);
    expect(fetchSearch).not.toHaveBeenCalled();
  });

  it("debounces 400ms and fires once with the final query (DG47)", async () => {
    const d = deferred<SearchResponse>();
    const fetchSearch = vi.fn(() => d.promise);
    const input = renderPanel(fetchSearch);

    type(input, "a");
    await advance(100);
    type(input, "ab");
    await advance(100);
    type(input, "abc");
    await advance(399);
    expect(fetchSearch).not.toHaveBeenCalled();
    await advance(1);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    expect(fetchSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: "abc" }),
    );

    await act(async () => {
      d.resolve(makeResponse(["Alpha"]));
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("shows skeletons on first load only; refetch keeps the old list (DG141)", async () => {
    const first = deferred<SearchResponse>();
    const second = deferred<SearchResponse>();
    const fetchSearch = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const input = renderPanel(fetchSearch);

    type(input, "abc");
    await advance(400);
    // First load: skeleton rows, no content.
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    await act(async () => {
      first.resolve(makeResponse(["Alpha"]));
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    type(input, "abcd");
    await advance(400);
    // Refetch: old list stays, no skeleton flash — only the spec §4 thin
    // head shimmer (a single h-0.5 bar, not skeleton rows).
    const pulses = document.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeLessThanOrEqual(1);
    expect(pulses[0]?.className).toContain("h-0.5");
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    await act(async () => {
      second.resolve(makeResponse(["Beta"]));
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("keeps the last good list on error and retry recovers", async () => {
    const good = deferred<SearchResponse>();
    const recovered = deferred<SearchResponse>();
    const fetchSearch = vi
      .fn()
      .mockImplementationOnce(() => good.promise)
      .mockImplementationOnce(() => Promise.reject(new Error("boom")))
      .mockImplementationOnce(() => recovered.promise);
    const input = renderPanel(fetchSearch);

    type(input, "abc");
    await advance(400);
    await act(async () => {
      good.resolve(makeResponse(["Alpha"]));
    });

    type(input, "xyz");
    await advance(400);
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't search");
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {
      recovered.resolve(makeResponse(["Beta"]));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("Esc clears the query and dismisses suggestions (DG56)", async () => {
    const d = deferred<SearchResponse>();
    const fetchSearch = vi.fn(() => d.promise);
    const input = renderPanel(fetchSearch);

    type(input, "abc");
    await advance(400);
    await act(async () => {
      d.resolve(makeResponse(["Alpha"]));
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(
      screen.getByText("Search cafes, neighborhoods, or addresses"),
    ).toBeInTheDocument();
  });

  it("discards a stale in-flight response when a newer query wins", async () => {
    const stale = deferred<SearchResponse>();
    const fresh = deferred<SearchResponse>();
    const fetchSearch = vi.fn(({ q }: { q: string }) =>
      q === "abc" ? stale.promise : fresh.promise,
    );
    const input = renderPanel(fetchSearch);

    type(input, "abc");
    await advance(400);
    type(input, "abcd");
    await advance(400);

    await act(async () => {
      fresh.resolve(makeResponse(["Fresh"]));
    });
    expect(screen.getByText("Fresh")).toBeInTheDocument();

    await act(async () => {
      stale.resolve(makeResponse(["Stale"]));
    });
    expect(screen.getByText("Fresh")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("Enter submits immediately and swaps to the rich results view (DG46)", async () => {
    const d = deferred<SearchResponse>();
    const fetchSearch = vi.fn(() => d.promise);
    const input = renderPanel(fetchSearch);

    type(input, "abc");
    // Enter inside the debounce window: fires now, not at +400ms.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    expect(fetchSearch).toHaveBeenCalledWith(expect.objectContaining({ q: "abc" }));

    await act(async () => {
      d.resolve(makeResponse(["Alpha"]));
    });
    // Results view carries the "view all" deep link to the SSR page.
    const viewAll = screen.getByRole("link", { name: "View all results" });
    expect(viewAll).toHaveAttribute("href", "/search?q=abc");

    // The pending debounce must not double-fetch on the submitted flip.
    await advance(1000);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
  });

  it("editing after submit returns to suggestion rows (DG46)", async () => {
    const first = deferred<SearchResponse>();
    const second = deferred<SearchResponse>();
    const fetchSearch = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const input = renderPanel(fetchSearch);

    type(input, "abc");
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => {
      first.resolve(makeResponse(["Alpha"]));
    });
    expect(screen.getByRole("link", { name: "View all results" })).toBeInTheDocument();

    type(input, "abcd");
    expect(screen.queryByRole("link", { name: "View all results" })).not.toBeInTheDocument();
    await advance(400);
    await act(async () => {
      second.resolve(makeResponse(["Beta"]));
    });
    // Back in suggestion mode: results render, but no view-all affordance.
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View all results" })).not.toBeInTheDocument();
  });
});

describe("UnifiedSearchPanel filters (BRAWUKA-512, DG44–DG58)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Desktop breakpoint → the inline collapsible panel (deterministic in
    // jsdom; the mobile Drawer path is covered by the same control set).
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Stateful host — mirrors `useDiscoverySearch`: the panel is a controlled
   * view over one filter object. */
  function FilteredPanel({ fetchSearch }: { fetchSearch: FetchSearch }) {
    const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
    return (
      <NextIntlClientProvider locale="en" messages={en}>
        <UnifiedSearchPanel
          externalSources={{ google: true, apple: false }}
          mapkitConfigured={false}
          onSelectResult={() => {}}
          onExternalSearch={() => {}}
          fetchSearch={fetchSearch}
          filters={filters}
          onFiltersChange={setFilters}
        />
      </NextIntlClientProvider>
    );
  }

  /** Stateful host with a city scope — mirrors `useDiscoverySearch`. */
  function CityPanel({ fetchSearch }: { fetchSearch: FetchSearch }) {
    const [city, setCity] = useState("singapore");
    return (
      <NextIntlClientProvider locale="en" messages={en}>
        <UnifiedSearchPanel
          externalSources={{ google: true, apple: false }}
          mapkitConfigured={false}
          city={city}
          onCityChange={setCity}
          onSelectResult={() => {}}
          onExternalSearch={() => {}}
          fetchSearch={fetchSearch}
        />
        <button type="button" onClick={() => setCity("tokyo")}>
          Switch city
        </button>
      </NextIntlClientProvider>
    );
  }

  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  it("badge counts active filters and chips remove them (DG54)", async () => {
    const fetchSearch = vi.fn<FetchSearch>(() => Promise.resolve(makeResponse(["Cafe A"])));
    render(<FilteredPanel fetchSearch={fetchSearch} />);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));

    // Desktop inline panel (matchMedia stubbed to matches:true above).
    const wifiGroup = screen.getByRole("radiogroup", { name: "Wifi" });
    fireEvent.click(within(wifiGroup).getByRole("radio", { name: "60+" }));
    fireEvent.click(screen.getByRole("switch", { name: "Open now" }));

    // Badge: two active filters, text not a bare dot (spec §9).
    expect(screen.getByRole("button", { name: "Filters, 2 active" })).toBeInTheDocument();
    // Chips row above results — one per active filter.
    expect(screen.getByRole("button", { name: "Remove Open now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Wifi 60+" })).toBeInTheDocument();

    // Removing the chip clears that filter and the badge drops.
    fireEvent.click(screen.getByRole("button", { name: "Remove Wifi 60+" }));
    expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Wifi 60+" })).not.toBeInTheDocument();
  });

  it("emits filter params and fetches in browse mode with an empty query", async () => {
    const fetchSearch = vi.fn<FetchSearch>(() => Promise.resolve(makeResponse(["Cafe A"])));
    render(<FilteredPanel fetchSearch={fetchSearch} />);

    // No query typed — filters alone must trigger the fetch (browse mode).
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const wifiGroup = screen.getByRole("radiogroup", { name: "Wifi" });
    fireEvent.click(within(wifiGroup).getByRole("radio", { name: "60+" }));
    await advance(400);

    expect(fetchSearch).toHaveBeenCalled();
    const params = fetchSearch.mock.calls.at(-1)?.[0];
    expect(params?.q).toBe("");
    expect(params?.filters?.thresholds.wifi).toBe(60);
  });

  it("filter-empty state offers a Reset CTA that clears everything", async () => {
    const fetchSearch = vi.fn<FetchSearch>(() => Promise.resolve(makeResponse([])));
    render(<FilteredPanel fetchSearch={fetchSearch} />);

    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("switch", { name: "Open now" }));
    await advance(400);

    expect(screen.getByText("No places match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));

    // Badge and chips disappear — the state object is the single truth.
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Open now" })).not.toBeInTheDocument();
  });

  it("refetches when filters change while the query is unchanged (BRAWUKA-567)", async () => {
    const fetchSearch = vi.fn<FetchSearch>(() => Promise.resolve(makeResponse(["Cafe A"])));
    render(<FilteredPanel fetchSearch={fetchSearch} />);
    const input = screen.getByPlaceholderText("Search cafes, neighborhoods, or addresses");

    fireEvent.change(input, { target: { value: "cafe" } });
    await advance(400);
    expect(fetchSearch).toHaveBeenCalledTimes(1);

    // Same query, new filter — the dedupe key covers the whole request.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("switch", { name: "Open now" }));
    await advance(400);

    expect(fetchSearch).toHaveBeenCalledTimes(2);
    const params = fetchSearch.mock.calls.at(-1)?.[0];
    expect(params?.q).toBe("cafe");
    expect(params?.filters?.openNow).toBe(true);
  });

  it("refetches when a dimension segment changes while the query is unchanged (BRAWUKA-615)", async () => {
    const fetchSearch = vi.fn<FetchSearch>(() => Promise.resolve(makeResponse(["Cafe A"])));
    render(<FilteredPanel fetchSearch={fetchSearch} />);
    const input = screen.getByPlaceholderText("Search cafes, neighborhoods, or addresses");
    fireEvent.change(input, { target: { value: "cafe" } });
    await advance(400);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    // Same query, new dimension threshold — the BRAWUKA-567 signature key
    // covers filter_* so this must fire a second request, not serve stale.
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const overallGroup = screen.getByRole("radiogroup", { name: "Overall" });
    fireEvent.click(within(overallGroup).getByRole("radio", { name: "60+" }));
    await advance(400);
    expect(fetchSearch).toHaveBeenCalledTimes(2);
    const params = fetchSearch.mock.calls.at(-1)?.[0];
    expect(params?.q).toBe("cafe");
    expect(params?.filters?.thresholds.overall).toBe(60);
  });

  it("refetches when the city scope changes while the query is unchanged (BRAWUKA-567)", async () => {
    const fetchSearch = vi.fn<FetchSearch>(() => Promise.resolve(makeResponse(["Cafe A"])));
    render(<CityPanel fetchSearch={fetchSearch} />);
    const input = screen.getByPlaceholderText("Search cafes, neighborhoods, or addresses");

    fireEvent.change(input, { target: { value: "cafe" } });
    await advance(400);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    expect(fetchSearch.mock.calls.at(-1)?.[0].city).toBe("singapore");

    fireEvent.click(screen.getByRole("button", { name: "Switch city" }));
    await advance(400);

    expect(fetchSearch).toHaveBeenCalledTimes(2);
    const params = fetchSearch.mock.calls.at(-1)?.[0];
    expect(params?.q).toBe("cafe");
    expect(params?.city).toBe("tokyo");
  });
});

