import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedSearchPanel } from "@/components/search/unified-search-panel";
import { writeOnboardingState } from "@/lib/onboarding-store";
import { setRankingPreference } from "@/lib/search/ranking-preference";
import {
  buildUnifiedSearchParams,
  type UnifiedSearchParams,
} from "@/lib/search/search-client";
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

interface DeferredCall {
  params: UnifiedSearchParams;
  resolve: (value: SearchResponse) => void;
  reject: (cause: unknown) => void;
}

/**
 * Fetch seam returning a manually-controlled promise per call. Like a real
 * `fetch`, the promise rejects the moment the signal aborts.
 */
function deferredSearch() {
  const calls: DeferredCall[] = [];
  const fetchSearch = (params: UnifiedSearchParams) =>
    new Promise<SearchResponse>((resolve, reject) => {
      calls.push({ params, resolve, reject });
      params.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      );
    });
  return { calls, fetchSearch };
}

interface TestHarnessProps {
  fetchSearch: (params: UnifiedSearchParams) => Promise<SearchResponse>;
  initialQuery?: string;
}

function TestHarness({ fetchSearch, initialQuery = "" }: TestHarnessProps) {
  const [filters, setFilters] = useState<SearchFilterState>(EMPTY_FILTERS);
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

const DEBOUNCE_MS = 400;

describe("UnifiedSearchPanel request lifecycle (BRAWUKA-726)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Enter while a debounced search is in flight keeps the request alive and renders its results", async () => {
    const { calls, fetchSearch } = deferredSearch();
    render(<TestHarness fetchSearch={fetchSearch} initialQuery="coffee" />);

    // Debounce fires the automatic suggestion search; it stays in flight.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].params.signal?.aborted).not.toBe(true);

    // Enter while the request is pending must not abort it nor refire the
    // identical request — the submitted view reuses the in-flight one.
    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].params.signal?.aborted).not.toBe(true);

    await act(async () => {
      calls[0].resolve(makeResponse(["Blue Bottle"]));
    });
    expect(screen.getByText("Blue Bottle")).toBeInTheDocument();
  });

  it("Enter while the debounce timer is pending fires exactly once", async () => {
    const { calls, fetchSearch } = deferredSearch();
    render(<TestHarness fetchSearch={fetchSearch} initialQuery="coffee" />);

    // Debounce timer still pending.
    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(calls).toHaveLength(1);

    // The orphaned timer must not fire a duplicate request.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      calls[0].resolve(makeResponse(["Blue Bottle"]));
    });
    expect(screen.getByText("Blue Bottle")).toBeInTheDocument();
  });

  it("query change cancels the in-flight request and debounces the replacement", async () => {
    const { calls, fetchSearch } = deferredSearch();
    render(<TestHarness fetchSearch={fetchSearch} initialQuery="coffee" />);

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(calls).toHaveLength(1);

    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "latte" } });
    });
    // Stale request is cancelled immediately, not only at fire time.
    expect(calls[0].params.signal?.aborted).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].params.q).toBe("latte");
    expect(calls[1].params.signal?.aborted).not.toBe(true);

    await act(async () => {
      calls[1].resolve(makeResponse(["Latte Place"]));
    });
    expect(screen.getByText("Latte Place")).toBeInTheDocument();
  });

  it("filter change cancels the in-flight request", async () => {
    const { calls, fetchSearch } = deferredSearch();
    render(<TestHarness fetchSearch={fetchSearch} initialQuery="coffee" />);

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId("set-filter-wifi"));
    });
    expect(calls[0].params.signal?.aborted).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].params.filters?.thresholds?.wifi).toBe(80);
  });

  it("clearing to idle cancels the in-flight request and returns to the idle hint", async () => {
    const { calls, fetchSearch } = deferredSearch();
    render(<TestHarness fetchSearch={fetchSearch} initialQuery="coffee" />);

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(calls).toHaveLength(1);

    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    expect(calls[0].params.signal?.aborted).toBe(true);

    // No replacement request is scheduled in idle.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });
    expect(calls).toHaveLength(1);
    expect(
      screen.getByText("Search cafes, neighborhoods, or addresses"),
    ).toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });
});

describe("request identity ↔ transport agreement (BRAWUKA-736)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Scope/ranking both resolve from device storage — seed it so one
    // attempt cannot resolve two different values for identity vs wire.
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  /**
   * Stubs global `fetch` (the layer `apiFetch` inside `fetchUnifiedSearch`
   * calls) and returns the captured request URLs. `/api/health` pings from
   * the network-status watchdog pass through the same stub — filter on
   * `/api/search`.
   */
  function stubFetchJson() {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      urls.push(String(input));
      // A structurally valid response — the panel renders whatever resolves.
      return new Response(JSON.stringify(makeResponse([])), { status: 200 });
    });
    return urls;
  }

  function renderPanel(props: {
    city?: string;
    filters?: SearchFilterState;
  }) {
    return render(
      <NextIntlClientProvider locale="en" messages={en}>
        <UnifiedSearchPanel
          city={props.city}
          filters={props.filters}
          onFiltersChange={() => {}}
          externalSources={{ google: true, apple: false }}
          mapkitConfigured={false}
          onSelectResult={() => {}}
          onExternalSearch={() => {}}
        />
      </NextIntlClientProvider>,
    );
  }

  it("launch city + filters + ranking: emitted URL equals the request-identity serialization", async () => {
    const urls = stubFetchJson();
    setRankingPreference("good_first");
    const filters: SearchFilterState = {
      openNow: true,
      thresholds: { wifi: 80 },
      maxStay: "3h",
    };
    renderPanel({ city: "singapore", filters });

    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.change(input, { target: { value: "coffee" } });
    });
    // Enter fires synchronously; the scheduled debounce adopts it (same
    // signature) and a second Enter dedupes instead of duplicating.
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    const searchCalls = urls.filter((u) => u.includes("/api/search"));
    expect(searchCalls).toHaveLength(1);
    // The emitted query string must be byte-identical to what the panel
    // signed — one serializer feeds both sides.
    const emitted = new URL(searchCalls[0], "http://test.local").search;
    expect(emitted).toBe(
      `?${buildUnifiedSearchParams({ q: "coffee", city: "singapore", filters }).toString()}`,
    );
    const emittedParams = new URLSearchParams(emitted);
    expect(emittedParams.get("q")).toBe("coffee");
    expect(emittedParams.get("city")).toBe("singapore");
    expect(emittedParams.get("open_now")).toBe("true");
    expect(emittedParams.get("filter_wifi")).toBe("80");
    expect(emittedParams.get("filter_max_stay")).toBe("3h");
    expect(emittedParams.get("ranking")).toBe("good_first");
  });

  it("runtime city falls back to the stored fix and ranking omission matches the identity", async () => {
    const urls = stubFetchJson();
    // Runtime city id is not a launch id → `?city=` must be dropped and the
    // stored lastLocation fix emitted as `?lat&lng` (BRAWUKA-568).
    writeOnboardingState({
      lastLocation: { lat: 10.5, lng: 107.25 },
    });
    const filters: SearchFilterState = {
      openNow: false,
      thresholds: { wifi: 80 },
      maxStay: null,
    };
    renderPanel({ city: "runtime-xyz", filters });

    // Empty query + active filters = browse mode: Enter submits `q=`.
    const input = screen.getByRole("searchbox");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    const searchCalls = urls.filter((u) => u.includes("/api/search"));
    expect(searchCalls).toHaveLength(1);
    const emitted = new URL(searchCalls[0], "http://test.local").search;
    expect(emitted).toBe(
      `?${buildUnifiedSearchParams({ q: "", city: "runtime-xyz", filters }).toString()}`,
    );
    const emittedParams = new URLSearchParams(emitted);
    expect(emittedParams.get("q")).toBe("");
    expect(emittedParams.get("city")).toBeNull();
    expect(emittedParams.get("lat")).toBe("10.5");
    expect(emittedParams.get("lng")).toBe("107.25");
    expect(emittedParams.get("ranking")).toBeNull();
  });
});
