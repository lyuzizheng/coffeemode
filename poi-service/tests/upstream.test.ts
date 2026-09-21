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
import { FakeD1, FakeKV, googleDetailResponse, mockFetch } from "./helpers";

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

  it("textSearch calls upstream and returns places", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ places: [googleDetailResponse()] }), { status: 200 }),
    );
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const places = await provider.textSearch("coffee", { lat: 37.7, lng: -122.4, radiusKm: 5 });
    expect(places).toHaveLength(1);
    expect(places[0].id).toBe("ChIJTEST123");
  });

  it("reverseGeocode returns normalized POI for food/cafe coordinates", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJTEST123",
                formatted_address: "66 Mint St, San Francisco, CA",
                types: ["cafe", "point_of_interest", "establishment"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJTEST123")) {
        return new Response(JSON.stringify(googleDetailResponse()), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 37.7825, lng: -122.4077 });
    expect(poi).not.toBeNull();
    expect(poi).toMatchObject({
      place_id: "ChIJTEST123",
      source: "google",
      name: "Blue Bottle Coffee",
      lat: 37.7825,
      lng: -122.4077,
    });
  });

  it("reverseGeocode filters out non-food establishments per BRAWUKA-328", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJBANK",
                formatted_address: "100 Market St, San Francisco, CA",
                types: ["bank", "point_of_interest", "establishment"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJBANK")) {
        return new Response(
          JSON.stringify({
            id: "ChIJBANK",
            displayName: { text: "Bank of America" },
            location: { latitude: 37.79, longitude: -122.4 },
            types: ["bank", "finance", "establishment"],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 37.79, lng: -122.4 });
    expect(poi).toBeNull();
  });

  it("reverseGeocode returns null when geocoding returns ZERO_RESULTS", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 }),
    );
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 0, lng: 0 });
    expect(poi).toBeNull();
  });

  it("reverseGeocode returns null when results contain no establishment", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch(() =>
      new Response(
        JSON.stringify({
          status: "OK",
          results: [
            {
              place_id: "ChIJSTREET",
              formatted_address: "Somewhere St",
              types: ["street_address", "route"],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 37.7, lng: -122.4 });
    expect(poi).toBeNull();
  });

  it("reverseGeocode throws GoogleApiError on geocoding failure", async () => {
    const env = makeEnv();
    const quotaFetch = mockFetch(() =>
      new Response(JSON.stringify({ status: "OVER_QUERY_LIMIT" }), { status: 200 }),
    );
    const provider = new GooglePlacesProvider(env, quotaFetch);

    await expect(provider.reverseGeocode({ lat: 37.7, lng: -122.4 })).rejects.toThrow(
      /Geocoding quota exceeded/,
    );

    const deniedFetch = mockFetch(() =>
      new Response(
        JSON.stringify({ status: "REQUEST_DENIED", error_message: "API key invalid" }),
        { status: 200 },
      ),
    );
    const deniedProvider = new GooglePlacesProvider(env, deniedFetch);
    // P0 scrub (BRAWUKA-539): the upstream `error_message` can echo the key
    // back, so the denial throws canned text — never the upstream message.
    await expect(deniedProvider.reverseGeocode({ lat: 37.7, lng: -122.4 })).rejects.toThrow(
      /Geocoding request denied/,
    );
  });

  it("reverseGeocode returns null when candidate details fetch returns 404", async () => {
    const env = makeEnv();
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJGHOST",
                types: ["cafe", "point_of_interest"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 37.7, lng: -122.4 });
    expect(poi).toBeNull();
  });

  it("reverseGeocode iterates past non-food establishment to hit next candidate food POI (BRAWUKA-332)", async () => {
    const env = makeEnv();
    const fetchCalls: string[] = [];
    const fetchImpl = mockFetch((url) => {
      fetchCalls.push(url);
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJBANK",
                types: ["bank", "point_of_interest", "establishment"],
              },
              {
                place_id: "ChIJCAFE",
                types: ["point_of_interest", "establishment"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJBANK")) {
        return new Response(
          JSON.stringify({
            id: "ChIJBANK",
            displayName: { text: "Bank of America" },
            location: { latitude: 37.79, longitude: -122.4 },
            types: ["bank", "finance", "establishment"],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJCAFE")) {
        return new Response(
          JSON.stringify({
            id: "ChIJCAFE",
            displayName: { text: "Sightglass Coffee" },
            location: { latitude: 37.78, longitude: -122.41 },
            types: ["cafe", "food", "establishment"],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 37.79, lng: -122.4 });
    expect(poi).not.toBeNull();
    expect(poi?.place_id).toBe("ChIJCAFE");
    expect(poi?.name).toBe("Sightglass Coffee");

    // Verified both places were fetched in order
    expect(fetchCalls.some((u) => u.includes("/v1/places/ChIJBANK"))).toBe(true);
    expect(fetchCalls.some((u) => u.includes("/v1/places/ChIJCAFE"))).toBe(true);
  });

  it("reverseGeocode iterates past 404 details to hit next candidate food POI (BRAWUKA-332)", async () => {
    const env = makeEnv();
    const fetchCalls: string[] = [];
    const fetchImpl = mockFetch((url) => {
      fetchCalls.push(url);
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "ChIJ404",
                types: ["point_of_interest", "establishment"],
              },
              {
                place_id: "ChIJCAFE",
                types: ["point_of_interest", "establishment"],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/ChIJ404")) {
        return new Response(null, { status: 404 });
      }
      if (url.includes("/v1/places/ChIJCAFE")) {
        return new Response(
          JSON.stringify({
            id: "ChIJCAFE",
            displayName: { text: "Ritual Coffee Roasters" },
            location: { latitude: 37.78, longitude: -122.41 },
            types: ["cafe", "establishment"],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 37.79, lng: -122.4 });
    expect(poi).not.toBeNull();
    expect(poi?.place_id).toBe("ChIJCAFE");
    expect(poi?.name).toBe("Ritual Coffee Roasters");
  });

  it("reverseGeocode bounds candidate inspections to MAX_REVERSE_GEOCODE_CANDIDATES (BRAWUKA-332)", async () => {
    const env = makeEnv();
    let detailCalls = 0;
    const fetchImpl = mockFetch((url) => {
      if (url.includes("/maps/api/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              { place_id: "ChIJ1", types: ["point_of_interest", "establishment"] },
              { place_id: "ChIJ2", types: ["point_of_interest", "establishment"] },
              { place_id: "ChIJ3", types: ["point_of_interest", "establishment"] },
              { place_id: "ChIJ4", types: ["point_of_interest", "establishment"] },
              { place_id: "ChIJ5", types: ["point_of_interest", "establishment"] },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/v1/places/")) {
        detailCalls++;
        return new Response(
          JSON.stringify({
            id: "non-food",
            displayName: { text: "Some Shop" },
            location: { latitude: 37.79, longitude: -122.4 },
            types: ["clothing_store", "establishment"],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });
    const provider = new GooglePlacesProvider(env, fetchImpl);

    const poi = await provider.reverseGeocode({ lat: 37.79, lng: -122.4 });
    expect(poi).toBeNull();
    // Strictly bounded to 3 Place Details calls
    expect(detailCalls).toBe(3);
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
