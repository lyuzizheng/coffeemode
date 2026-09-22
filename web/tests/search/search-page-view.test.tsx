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
