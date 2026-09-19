import { describe, expect, it } from "vitest";
import { parseSearchQuery, serializeSearchParams } from "@/lib/search/search-params";

/**
 * The deep-link contract (DG48): `/api/search` and the SSR `/search` page
 * share one parser + serializer, so parameter names and value semantics can
 * never drift between the map panel, the API, and the shareable URL.
 */
function params(entries: Record<string, string>): (name: string) => string | null {
  return (name) => entries[name] ?? null;
}

describe("parseSearchQuery", () => {
  it("parses the full deep-link contract", () => {
    const { filters } = parseSearchQuery(
      params({
        q: "  kopi  ",
        city: "singapore",
        lat: "1.3",
        lng: "103.8",
        open_now: "true",
        include_live: "1",
        filter_wifi: "60",
        filter_outlets: "80",
        filter_max_stay: "3h",
        limit: "10",
        ranking: "good_first",
      }),
    );
    expect(filters).toMatchObject({
      q: "kopi",
      city: "singapore",
      lat: 1.3,
      lng: 103.8,
      open_now: true,
      include_live: true,
      filter_wifi: 60,
      filter_outlets: 80,
      filter_max_stay: "3h",
      limit: 10,
      ranking: "good_first",
    });
  });

  it("drops malformed values instead of throwing", () => {
    const { filters } = parseSearchQuery(
      params({
        lat: "abc",
        open_now: "maybe",
        filter_wifi: "120",
        filter_seats: "-5",
        filter_max_stay: "forever",
        ranking: "best",
      }),
    );
    expect(filters.lat).toBeUndefined();
    expect(filters.open_now).toBe(false); // present-but-not-true parses false
    expect(filters.filter_wifi).toBeUndefined(); // out of 0-100 range
    expect(filters.filter_seats).toBeUndefined();
    expect(filters.filter_max_stay).toBeUndefined();
    expect(filters.ranking).toBeUndefined();
  });

  it("keeps the raw limit so the API can 400 on invalid input", () => {
    expect(parseSearchQuery(params({ limit: "-3" })).rawLimit).toBe("-3");
    expect(parseSearchQuery(params({})).rawLimit).toBeNull();
    expect(parseSearchQuery(params({ limit: "5" })).filters.limit).toBe(5);
  });
});

describe("serializeSearchParams", () => {
  it("round-trips the parsed contract", () => {
    const { filters } = parseSearchQuery(
      params({
        q: "kopi",
        city: "tokyo",
        open_now: "true",
        filter_wifi: "60",
        filter_max_stay: "2h",
      }),
    );
    const serialized = serializeSearchParams(filters);
    expect(serialized.get("q")).toBe("kopi");
    expect(serialized.get("city")).toBe("tokyo");
    expect(serialized.get("open_now")).toBe("true");
    expect(serialized.get("filter_wifi")).toBe("60");
    expect(serialized.get("filter_max_stay")).toBe("2h");
    expect(serialized.get("filter_outlets")).toBeNull();
  });

  it("omits absent params entirely (Any = no threshold)", () => {
    const serialized = serializeSearchParams({ q: "x" });
    expect(serialized.toString()).toBe("q=x");
  });
});
