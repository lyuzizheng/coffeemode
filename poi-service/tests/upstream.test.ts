import { describe, expect, it, vi } from "vitest";
import {
  APPLE_FOOD_CAFE_CATEGORIES,
  getUpstreamProvider,
  GoogleApiError,
  GooglePlacesProvider,
  isAppleFoodOrCafePOI,
  isGooglePlaceId,
  matchesFoodCategory,
  resolveUpstreamSource,
  UpstreamApiError,
  type GooglePlace,
} from "../src/upstream";
import type { Env } from "../src/types";
import { FakeD1, FakeKV, autocompleteSuggestion, googleDetailResponse, mockFetch } from "./helpers";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    POI_SERVICE_TOKEN: "test-token",
    GOOGLE_PLACES_API_KEY: "test-key",
    POI_KV: new FakeKV(),
    POI_DB: new FakeD1(),
    GOOGLE_PLACES_BASE_URL: "https://places.test",
    ...overrides,
  };
}

describe("upstream provider resolution", () => {
  it("returns GooglePlacesProvider for google source", () => {
    const env = makeEnv();
    const provider = getUpstreamProvider("google", env);
    expect(provider).toBeInstanceOf(GooglePlacesProvider);
  });

  it("returns null for apple source (no server-side Places API)", () => {
    const env = makeEnv();
    const provider = getUpstreamProvider("apple", env);
    expect(provider).toBeNull();
  });

  it("resolves source honoring stored source over prefix heuristic (issue #38)", () => {
    // Stored apple row with ChIJ prefix -> apple
    expect(resolveUpstreamSource("ChIJ_APPLE", "apple")).toBe("apple");
    // Stored google row with non-prefix id -> google
    expect(resolveUpstreamSource("goog-opaque-id", "google")).toBe("google");
    // Never-seen ChIJ id -> google
    expect(resolveUpstreamSource("ChIJ12345", null)).toBe("google");
    // Never-seen 0x hex id -> google
    expect(resolveUpstreamSource("0x8085:0x9f2c", null)).toBe("google");
    // Never-seen arbitrary id -> null
    expect(resolveUpstreamSource("unknown-id-123", null)).toBeNull();
  });

  it("isGooglePlaceId recognizes ChIJ and 0x prefixes", () => {
    expect(isGooglePlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe(true);
    expect(isGooglePlaceId("0x60188b9d2f2a2b79:0x9f2c0f1d2e3a4b5c")).toBe(true);
    expect(isGooglePlaceId("apple-12345")).toBe(false);
    expect(isGooglePlaceId("foo-bar")).toBe(false);
  });
});

describe("GooglePlacesProvider", () => {
  it("matchesCategory filters food/cafe types correctly", () => {
    const env = makeEnv();
    const provider = new GooglePlacesProvider(env);

    expect(provider.matchesCategory(["cafe"])).toBe(true);
    expect(provider.matchesCategory(["coffee_shop"])).toBe(true);
    expect(provider.matchesCategory(["bakery", "store"])).toBe(true);
    expect(provider.matchesCategory(["book_store", "library"])).toBe(false);
    expect(provider.matchesCategory([])).toBe(false);
  });

  it("toPOI normalizes Google place and throws on missing location", () => {
    const env = makeEnv();
    const provider = new GooglePlacesProvider(env);

    const raw = googleDetailResponse() as unknown as GooglePlace;
    const poi = provider.toPOI(raw);
    expect(poi).toMatchObject({
      place_id: "ChIJTEST123",
      source: "google",
      name: "Blue Bottle Coffee",
      lat: 37.7825,
      lng: -122.4077,
    });

    expect(() => provider.toPOI({ id: "ChIJNOLOC" })).toThrow(
      /refusing to store at \(0,0\)/,
    );
  });

  it("getDetails calls upstream with field mask and handles error", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify(googleDetailResponse()), { status: 200 }),
    );
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const details = await provider.getDetails("ChIJTEST123");
    expect(details.id).toBe("ChIJTEST123");
  });

  it("getDetails forwards the session token that terminates an Autocomplete session", async () => {
    const env = makeEnv();
    let url = "";
    const fetchImpl = mockFetch((u) => {
      url = u;
      return new Response(JSON.stringify(googleDetailResponse()), { status: 200 });
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    await provider.getDetails("ChIJTEST123", "3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(url).toContain("sessionToken=3f2504e0-4f89-41d3-9a0c-0305e82c3301");

    // No token → no query string at all (plain Place Details request).
    await provider.getDetails("ChIJTEST123");
    expect(url).not.toContain("sessionToken");
  });

  it("autocomplete calls upstream with the session token and maps predictions", async () => {
    const env = makeEnv();
    let sent: Record<string, unknown> = {};
    const fetchImpl = mockFetch((_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ suggestions: [autocompleteSuggestion({ placeId: "ChIJTEST123" })] }),
        { status: 200 },
      );
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const predictions = await provider.autocomplete("coffee", {
      lat: 37.7,
      lng: -122.4,
      radiusKm: 5,
      sessionToken: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });

    expect(predictions).toHaveLength(1);
    expect(predictions[0]).toMatchObject({ place_id: "ChIJTEST123", name: "Blue Bottle Coffee" });
    expect(sent.sessionToken).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  });

  it("autocomplete drops suggestions without a place id", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(
        JSON.stringify({
          suggestions: [
            { placePrediction: { text: { text: "no id here" } } },
            autocompleteSuggestion({ placeId: "ChIJKEEP" }),
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const predictions = await provider.autocomplete("coffee", {
      sessionToken: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    });
    expect(predictions.map((p) => p.place_id)).toEqual(["ChIJKEEP"]);
  });

  it("GoogleApiError inherits from UpstreamApiError", () => {
    const err = new GoogleApiError("upstream fail", 503);
    expect(err).toBeInstanceOf(UpstreamApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(503);
    expect(err.message).toBe("upstream fail");
  });
});

describe("Apple category map (BRAWUKA-328)", () => {
  it("matches the full food/drink subset of MKPointOfInterestCategory", () => {
    for (const category of [
      "Cafe",
      "Restaurant",
      "Bakery",
      "FoodMarket",
      "Brewery",
      "Distillery",
      "Winery",
      "Nightlife",
    ]) {
      expect(isAppleFoodOrCafePOI([category])).toBe(true);
    }
    // Case-insensitive: the client passes MapKit values verbatim.
    expect(isAppleFoodOrCafePOI(["cafe"])).toBe(true);
    expect(isAppleFoodOrCafePOI(["FOODMARKET"])).toBe(true);
    // The allowlist is exactly these 8 — a taxonomy addition must be a
    // deliberate test change, not a silent map edit.
    expect(Object.keys(APPLE_FOOD_CAFE_CATEGORIES).sort()).toEqual([
      "bakery",
      "brewery",
      "cafe",
      "distillery",
      "foodmarket",
      "nightlife",
      "restaurant",
      "winery",
    ]);
  });

  it("fails closed on non-food, unknown, and empty categories", () => {
    expect(isAppleFoodOrCafePOI(["Bank"])).toBe(false);
    expect(isAppleFoodOrCafePOI(["Hotel"])).toBe(false);
    expect(isAppleFoodOrCafePOI(["TimeTravelParlor"])).toBe(false);
    expect(isAppleFoodOrCafePOI([])).toBe(false);
    expect(isAppleFoodOrCafePOI(null)).toBe(false);
    expect(isAppleFoodOrCafePOI(undefined)).toBe(false);
  });

  it("matchesFoodCategory dispatches on source and fails closed on unknown sources", () => {
    expect(matchesFoodCategory("apple", ["Cafe"])).toBe(true);
    expect(matchesFoodCategory("apple", ["Bank"])).toBe(false);
    expect(matchesFoodCategory("apple", [])).toBe(false);
    expect(matchesFoodCategory("google", ["cafe"])).toBe(true);
    expect(matchesFoodCategory("google", ["bank"])).toBe(false);
    expect(matchesFoodCategory("google", [])).toBe(false);
    expect(matchesFoodCategory("yahoo", ["Cafe"])).toBe(false);
  });
});
