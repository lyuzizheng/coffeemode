import { NextIntlClientProvider } from "next-intl";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedSearchPanel } from "@/components/search/unified-search-panel";
import type { UnifiedSearchParams } from "@/lib/search/search-client";
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
    // Refetch: old list stays, no skeleton flash.
    expect(document.querySelectorAll(".animate-pulse")).toHaveLength(0);
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
});
