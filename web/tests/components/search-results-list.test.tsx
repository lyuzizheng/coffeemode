import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SearchResultsList,
  type ExternalSourceFlags,
} from "@/components/search/search-results-list";
import type { SearchResponse, SearchResultItem } from "@/lib/search/types";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

function makeItem(
  id: string,
  source: SearchResultItem["source"],
  overrides: Partial<SearchResultItem> = {},
): SearchResultItem {
  return {
    id,
    type: source === "coffeemode" ? "cafe" : "poi",
    source,
    name: `Place ${id}`,
    address: "Somewhere",
    lat: 1.3,
    lng: 103.8,
    distance_m: 1200,
    is_from_city_center: false,
    ...overrides,
  };
}

function makeResponse(
  results: SearchResultItem[],
  overrides: Partial<SearchResponse> = {},
): SearchResponse {
  return {
    results,
    total_count: results.length,
    is_weak_results: false,
    reference_point: { lat: 1.3, lng: 103.8, is_from_city_center: false },
    ...overrides,
  };
}

function renderList({
  response,
  externalSources = { google: true, apple: true },
  mapkitConfigured,
  locale = "en",
}: {
  response: SearchResponse;
  externalSources?: ExternalSourceFlags;
  mapkitConfigured?: boolean;
  locale?: "en" | "zh";
}) {
  const onSelect = vi.fn();
  const onExternalSearch = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en}>
      <SearchResultsList
        response={response}
        externalSources={externalSources}
        mapkitConfigured={mapkitConfigured}
        onSelect={onSelect}
        onExternalSearch={onExternalSearch}
      />
    </NextIntlClientProvider>,
  );
  return { onSelect, onExternalSearch };
}

describe("SearchResultsList — DG131 grouped rendering", () => {
  const mixed = makeResponse([
    makeItem("g1", "google"),
    makeItem("c1", "coffeemode"),
    makeItem("s1", "stored_poi"),
    makeItem("c2", "coffeemode"),
  ]);

  it("renders the coffeemode group before the POI group, preserving server order", () => {
    renderList({ response: mixed });

    const headers = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headers).toEqual(["On CoffeeMode", "More places"]);

    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    const order = ["Place c1", "Place c2", "Place g1", "Place s1"].map((name) =>
      rows.findIndex((text) => text.includes(name)),
    );
    expect(order).not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("renders no group header for an empty group", () => {
    renderList({ response: makeResponse([makeItem("c1", "coffeemode")]) });
    expect(screen.getByRole("heading", { name: "On CoffeeMode" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "More places" })).not.toBeInTheDocument();
  });

  it("marks POI rows as not yet on CoffeeMode", () => {
    renderList({ response: mixed });
    expect(screen.getAllByText(/Not on CoffeeMode yet/)).toHaveLength(2);
  });
});

describe("SearchResultsList — DG134/DG143 CTA visibility", () => {
  const weak = makeResponse([makeItem("c1", "coffeemode")], { is_weak_results: true });

  it("hides the whole prompt when both sources are off", () => {
    renderList({ response: weak, externalSources: { google: false, apple: false } });
    expect(screen.queryByText("Not finding it?")).not.toBeInTheDocument();
  });

  it("shows Google but keeps Apple hidden until MapKit is configured", () => {
    renderList({ response: weak, mapkitConfigured: false });
    expect(screen.getByRole("button", { name: "Search Google Maps" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search Apple Maps" })).not.toBeInTheDocument();
  });

  it("shows the Apple CTA only when the source is on AND MapKit is configured", () => {
    renderList({ response: weak, mapkitConfigured: true });
    expect(screen.getByRole("button", { name: "Search Apple Maps" })).toBeInTheDocument();
  });

  it("hides a source-disabled CTA even when its platform gate passes", () => {
    renderList({
      response: weak,
      externalSources: { google: false, apple: true },
      mapkitConfigured: true,
    });
    expect(screen.getByRole("button", { name: "Search Apple Maps" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search Google Maps" })).not.toBeInTheDocument();
  });

  it("shows the prompt on empty results and reports the provider on tap", async () => {
    const { onExternalSearch } = renderList({
      response: makeResponse([], { is_weak_results: true }),
      mapkitConfigured: false,
    });
    screen.getByRole("button", { name: "Search Google Maps" }).click();
    expect(onExternalSearch).toHaveBeenCalledWith("google");
  });
});

describe("SearchResultsList — DG138 city-center distance label", () => {
  it("renders 距市中心 when the distance is anchored on the city center", () => {
    renderList({
      response: makeResponse([
        makeItem("c1", "coffeemode", { is_from_city_center: true }),
      ]),
      locale: "zh",
    });
    expect(screen.getByText(/距市中心/)).toBeInTheDocument();
  });

  it("labels user-anchored distances plainly (no city-center suffix)", () => {
    renderList({
      response: makeResponse([makeItem("c1", "coffeemode")]),
    });
    expect(screen.queryByText(/from city center/)).not.toBeInTheDocument();
  });
});
