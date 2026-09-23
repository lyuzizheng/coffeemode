import { describe, expect, it } from "vitest";
import { MAX_STAY_FILTER_VALUES } from "@/lib/search/search-filters";
import en from "../../messages/en.json";
import zh from "../../messages/zh.json";

/**
 * BRAWUKA-667: the max-stay filter group renders `search.any` ("clear filter")
 * beside `search.maxStayOptions.*`. In zh both resolved to "不限", so the
 * radiogroup showed two identical options. The group's visible labels must be
 * pairwise distinct in every locale.
 */
function expectPairwiseDistinct(labels: string[]) {
  const sorted = [...labels].sort();
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i]).not.toBe(sorted[i - 1]);
  }
}

describe("search max-stay filter copy (BRAWUKA-667)", () => {
  for (const [locale, messages] of [["en", en], ["zh", zh]] as const) {
    it(`renders distinct max-stay options in ${locale}`, () => {
      expectPairwiseDistinct([
        messages.search.any,
        ...MAX_STAY_FILTER_VALUES.map((v) => messages.search.maxStayOptions[v]),
      ]);
    });
  }

  it("keeps zh clear-filter and unlimited-duration copy apart", () => {
    expect(zh.search.maxStayOptions.unlimited).not.toBe(zh.search.any);
  });
});
