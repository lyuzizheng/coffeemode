import { describe, expect, it } from "vitest";
import { groupSearchResults } from "@/lib/search/grouped-results";
import type { SearchResultItem } from "@/lib/search/types";

function item(id: string, source: SearchResultItem["source"]): SearchResultItem {
  return {
    id,
    type: source === "coffeemode" ? "cafe" : "poi",
    source,
    name: `Place ${id}`,
    address: null,
    lat: 0,
    lng: 0,
    distance_m: null,
    is_from_city_center: false,
  };
}

describe("groupSearchResults (DG131)", () => {
  it("puts the coffeemode group first, then the POI group", () => {
    const { coffeemode, external } = groupSearchResults([
      item("g1", "google"),
      item("c1", "coffeemode"),
      item("s1", "stored_poi"),
      item("c2", "coffeemode"),
      item("a1", "apple"),
    ]);

    expect(coffeemode.map((i) => i.id)).toEqual(["c1", "c2"]);
    expect(external.map((i) => i.id)).toEqual(["g1", "s1", "a1"]);
  });

  it("preserves server intra-group order exactly (no re-sort)", () => {
    // Server order inside each group is relevance → distance → name → id;
    // the client must not reorder, so a "wrong-looking" order passes through.
    const serverOrder = [
      item("z-first", "coffeemode"),
      item("a-second", "coffeemode"),
      item("z-poi", "stored_poi"),
      item("a-poi", "google"),
    ];
    const { coffeemode, external } = groupSearchResults(serverOrder);
    expect(coffeemode.map((i) => i.id)).toEqual(["z-first", "a-second"]);
    expect(external.map((i) => i.id)).toEqual(["z-poi", "a-poi"]);
  });

  it("handles single-group and empty responses", () => {
    expect(groupSearchResults([])).toEqual({ coffeemode: [], external: [] });
    const onlyCafes = groupSearchResults([item("c1", "coffeemode")]);
    expect(onlyCafes.external).toEqual([]);
    const onlyPois = groupSearchResults([item("g1", "google")]);
    expect(onlyPois.coffeemode).toEqual([]);
  });
});
