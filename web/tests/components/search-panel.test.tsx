import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { UnifiedSearchPanel } from "@/components/search/unified-search-panel";
import { EMPTY_FILTERS, type SearchFilterState } from "@/lib/search/search-filters";
import type { UnifiedSearchParams } from "@/lib/search/search-client";
import type { SearchResponse } from "@/lib/search/types";
import messages from "../../messages/en.json";

// The real hook fires a `/api/health` probe — irrelevant to the submit gate.
vi.mock("@/hooks/use-network-status", () => ({
  useNetworkStatus: () => ({ isOffline: false }),
}));

const RESPONSE: SearchResponse = {
  results: [],
  total_count: 0,
  is_weak_results: false,
  reference_point: {
    lat: null,
    lng: null,
    is_from_city_center: false,
    city_id: "singapore",
  },
};

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function renderPanel(
  filters: SearchFilterState,
  fetchSearch: (params: UnifiedSearchParams) => Promise<SearchResponse>,
) {
  render(
    <Wrapper>
      <UnifiedSearchPanel
        externalSources={{ google: false, apple: false }}
        mapkitConfigured={false}
        onSelectResult={vi.fn()}
        onExternalSearch={vi.fn()}
        fetchSearch={fetchSearch}
        filters={filters}
        onFiltersChange={vi.fn()}
      />
    </Wrapper>,
  );
  return screen.getByPlaceholderText("Search cafes, neighborhoods, or addresses");
}

describe("UnifiedSearchPanel Enter submit (BRAWUKA-520)", () => {
  it("submits the results view with active filters and an empty query", async () => {
    const fetchSearch = vi.fn().mockResolvedValue(RESPONSE);
    const input = renderPanel(
      { openNow: true, thresholds: {}, maxStay: null },
      fetchSearch,
    );

    fireEvent.keyDown(input, { key: "Enter" });

    // The submitted view exposes the filter-preserving "view all" deep link.
    const link = await screen.findByRole("link", { name: "View all results" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^\/search\?/);
    expect(href).toContain("open_now=true");
    // Enter fired the request itself; the debounced effect must not refire it.
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    await delay(500);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
  });

  it("stays a no-op for a sub-min-length query with no active filters", async () => {
    const fetchSearch = vi.fn().mockResolvedValue(RESPONSE);
    const input = renderPanel(EMPTY_FILTERS, fetchSearch);

    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await delay(500);
    expect(fetchSearch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: "View all results" }),
    ).not.toBeInTheDocument();
  });
});
