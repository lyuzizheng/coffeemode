import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SearchResultRichRow } from "@/components/search/search-result-rich-row";
import type { SearchResultItem } from "@/lib/search/types";
import type { CafeSummary } from "@/types/cafes";
import messages from "../../messages/en.json";

function cafe(visibility: "public" | "private"): CafeSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Chye Seng Huat Hardware",
    lat: 1.3118,
    lng: 103.8596,
    address: "150 Tyrwhitt Rd",
    city: "singapore",
    tz: "Asia/Singapore",
    opening_hours: null,
    price_range: 2,
    work_stats: {
      n_users: 0,
      n_checkins: 0,
      dims: {
        wifi: { sum: 0, n: 0 },
        outlets: { sum: 0, n: 0 },
        seats: { sum: 0, n: 0 },
        temp: { sum: 0, n: 0 },
        coffee: { sum: 0, n: 0 },
        overall: { sum: 0, n: 0 },
      },
      policies: { max_stay: {} },
      experience_score: null,
      composite_score: null,
      updated_at: "2026-01-01T00:00:00Z",
    },
    cover: null,
    maintained_by_service: false,
    visibility,
  };
}

function item(visibility: "public" | "private"): SearchResultItem {
  const c = cafe(visibility);
  return {
    id: c.id,
    type: "cafe",
    source: "coffeemode",
    name: c.name,
    address: c.address,
    lat: c.lat,
    lng: c.lng,
    distance_m: 1200,
    is_from_city_center: false,
    cafe: c,
  };
}

function renderRow(visibility: "public" | "private") {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SearchResultRichRow item={item(visibility)} />
    </NextIntlClientProvider>,
  );
}

describe("SearchResultRichRow PrivateBadge (BRAWUKA-520)", () => {
  it("renders the badge on a private cafe row", () => {
    renderRow("private");
    expect(screen.getByText("Only you can see this")).toBeInTheDocument();
  });

  it("omits the badge on a public cafe row", () => {
    renderRow("public");
    expect(screen.queryByText("Only you can see this")).not.toBeInTheDocument();
  });
});
