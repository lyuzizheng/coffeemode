import { describe, expect, it } from "vitest";
import { cafeCanonicalPath, cafeJsonLd, cafeOgImageUrl, ogHookParams } from "@/lib/seo";
import { emptyWorkStats } from "@/lib/stats/work-stats";
import type { WorkStats } from "@/lib/stats/work-stats";
import type { StoredImage } from "@/types/images";

const CAFE_ID = "550e8400-e29b-41d4-a716-446655440001";

function photo(id: string): StoredImage {
  return {
    id,
    original: `original/${id}.webp`,
    card: `card/${id}.webp`,
    thumbnail: `thumbnail/${id}.webp`,
    w: 1600,
    h: 1200,
    by: "550e8400-e29b-41d4-a716-446655440099",
    at: "2026-08-20T00:00:00.000Z",
  };
}

function statsWith(experience: number | null, checkins: number): WorkStats {
  return { ...emptyWorkStats(), experience_score: experience, n_checkins: checkins };
}

describe("cafeCanonicalPath", () => {
  it("is the stable id-based path (DG104)", () => {
    expect(cafeCanonicalPath(CAFE_ID)).toBe(`/cafes/${CAFE_ID}`);
  });
});

describe("ogHookParams (DG108)", () => {
  it("rounds the experience score and carries the respondent count", () => {
    expect(ogHookParams(statsWith(86.6, 23))).toEqual({ score: 87, count: 23 });
  });

  it("is null without a score — copy uses the honest empty variant", () => {
    expect(ogHookParams(statsWith(null, 23))).toBeNull();
  });

  it("is null without check-ins, even if a stale score lingers", () => {
    expect(ogHookParams(statsWith(80, 0))).toBeNull();
  });
});

describe("cafeOgImageUrl", () => {
  it("prefers the cover key on the public CDN", () => {
    const url = cafeOgImageUrl({ cover: "card/a.webp", gallery: [photo("b")] });
    expect(url).toBe("https://images.coffeemode.app/card/a.webp");
  });

  it("falls back to the first gallery card", () => {
    const url = cafeOgImageUrl({ cover: null, gallery: [photo("b")] });
    expect(url).toBe("https://images.coffeemode.app/card/b.webp");
  });

  it("is null when the cafe has no photo — the dynamic fallback card applies", () => {
    expect(cafeOgImageUrl({ cover: null, gallery: [] })).toBeNull();
  });
});

describe("cafeJsonLd (DG105)", () => {
  const base = {
    name: "Caracara",
    address: "12 Keong Saik Rd",
    city: "Singapore",
    lat: 1.2789,
    lng: 103.8425,
  };

  it("describes a CafeOrCoffeeShop with geo and a text address", () => {
    const jsonLd = cafeJsonLd(
      { ...base, work_stats: statsWith(86.6, 23) },
      `https://coffeemode.app/cafes/${CAFE_ID}`,
    );
    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "CafeOrCoffeeShop",
      name: "Caracara",
      url: `https://coffeemode.app/cafes/${CAFE_ID}`,
      address: "12 Keong Saik Rd, Singapore",
      geo: { "@type": "GeoCoordinates", latitude: 1.2789, longitude: 103.8425 },
    });
  });

  it("carries aggregateRating only when there is a score", () => {
    const rated = cafeJsonLd({ ...base, work_stats: statsWith(86.6, 23) }, "u");
    expect(rated.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 87,
      bestRating: 100,
      worstRating: 0,
      ratingCount: 23,
    });
    const unrated = cafeJsonLd({ ...base, work_stats: statsWith(null, 0) }, "u");
    expect(unrated.aggregateRating).toBeUndefined();
  });

  it("omits the address field when neither address nor city is known", () => {
    const jsonLd = cafeJsonLd(
      { name: "X", address: null, city: null, lat: 0, lng: 0, work_stats: statsWith(null, 0) },
      "u",
    );
    expect(jsonLd.address).toBeUndefined();
  });
});
