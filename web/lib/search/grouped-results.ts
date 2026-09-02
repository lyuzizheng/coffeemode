import type { SearchResultItem } from "./types";

/**
 * DG131 grouped rendering — pure presentation over the server-ordered
 * `SearchResponse.results`: CoffeeMode cafes first, then the POI group
 * (`stored_poi` / `google` / `apple`). Partition is stable, so the server's
 * intra-group order (relevance → distance → name → id, DG142) is preserved;
 * no cross-group re-sort happens here.
 */
export interface GroupedSearchResults {
  coffeemode: SearchResultItem[];
  external: SearchResultItem[];
}

export function groupSearchResults(results: SearchResultItem[]): GroupedSearchResults {
  const coffeemode: SearchResultItem[] = [];
  const external: SearchResultItem[] = [];
  for (const item of results) {
    if (item.source === "coffeemode") {
      coffeemode.push(item);
    } else {
      external.push(item);
    }
  }
  return { coffeemode, external };
}
