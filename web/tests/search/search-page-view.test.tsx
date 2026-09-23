import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchPageView } from "@/app/search/search-page-view";
import en from "@/messages/en.json";

// The masthead needs the app-router context; irrelevant to the error state.
vi.mock("@/components/site-masthead", () => ({
  SiteMasthead: () => <header />,
}));
const baseProps = {
  q: "",
  effectiveCity: "singapore",
  filters: {},
  params: new URLSearchParams(),
  response: null,
  failed: false,
  externalSources: { google: false, apple: false },
  mapkitConfigured: false,
};

describe("SearchPageView invalid params", () => {
  it("renders the invalid-params error state for lat/lng/limit failures", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SearchPageView {...baseProps} invalidParam="lat" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(en.search.invalid_params);
  });

  it("keeps the unknown-city copy for city failures", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SearchPageView {...baseProps} invalidParam="city" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(en.search.unknown_city);
  });
});

describe("SearchPageView empty states", () => {
  const emptyResponse = {
    results: [],
    total_count: 0,
    is_weak_results: false,
    reference_point: { lat: 1.3, lng: 103.8, is_from_city_center: false },
  };

  it("renders generic empty state when results are empty without active filters", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SearchPageView
          {...baseProps}
          q="nonexistent"
          response={emptyResponse}
          invalidParam={null}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(en.search.no_results)).toBeInTheDocument();
    expect(screen.getByText(en.search.no_results_hint)).toBeInTheDocument();
    expect(screen.queryByText(en.search.no_match_filters)).not.toBeInTheDocument();
  });

  it("renders filter empty state when results are empty with active filters", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SearchPageView
          {...baseProps}
          q="test"
          filters={{ open_now: true }}
          params={new URLSearchParams("open_now=true")}
          response={emptyResponse}
          invalidParam={null}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(en.search.no_match_filters)).toBeInTheDocument();
    expect(screen.getByText(en.search.loosen_filters)).toBeInTheDocument();
    expect(screen.queryByText(en.search.no_results)).not.toBeInTheDocument();
  });
});

