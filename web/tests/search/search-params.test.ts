import { describe, expect, it } from "vitest";
import { parseSearchQuery, serializeSearchParams, validateSearchQuery } from "@/lib/search/search-params";

/**
 * The deep-link contract (DG48): `/api/search` and the SSR `/search` page
 * share one parser + serializer, so parameter names and value semantics can
 * never drift between the map panel, the API, and the shareable URL.
 */
function params(
  entries: Record<string, string | string[]>,
): (name: string) => string | string[] | null {
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
    const { filters, rawLat } = parseSearchQuery(
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
    expect(rawLat).toBe("abc"); // raw stays so validation can 400 (BRAWUKA-670)
    expect(filters.open_now).toBe(false); // present-but-not-true parses false
    expect(filters.filter_wifi).toBeUndefined(); // out of 0-100 range
    expect(filters.filter_seats).toBeUndefined();
    expect(filters.filter_max_stay).toBeUndefined();
    expect(filters.ranking).toBeUndefined();
  });

  it("resolves a repeated param to its first value on both surfaces (BRAWUKA-670)", () => {
    // SSR `searchParams` yields arrays; the API's URLSearchParams.get takes
    // the first value — the shared parser normalizes so they cannot drift.
    const { filters } = parseSearchQuery(
      params({ lat: ["1.3", "4.5"], lng: "103.8", q: ["kopi", "toast"] }),
    );
    expect(filters.lat).toBe(1.3);
    expect(filters.lng).toBe(103.8);
    expect(filters.q).toBe("kopi");
  });

  it("keeps the raw coordinate/limit strings so validation can 400 on invalid input", () => {
    expect(parseSearchQuery(params({ limit: "-3" })).rawLimit).toBe("-3");
    expect(parseSearchQuery(params({})).rawLimit).toBeNull();
    expect(parseSearchQuery(params({ limit: "5" })).filters.limit).toBe(5);
    expect(parseSearchQuery(params({ lat: "abc", lng: "103.8" }))).toMatchObject({
      rawLat: "abc",
      rawLng: "103.8",
    });
    expect(parseSearchQuery(params({}))).toMatchObject({ rawLat: null, rawLng: null });
  });
});

describe("validateSearchQuery", () => {
  const validate = (entries: Record<string, string>) =>
    validateSearchQuery(parseSearchQuery(params(entries)));

  it("accepts absent, blank, and in-range params", () => {
    expect(validate({})).toMatchObject({ ok: true });
    expect(validate({ lat: "1.3", lng: "103.8", limit: "10", city: "tokyo" })).toMatchObject({
      ok: true,
    });
    expect(validate({ limit: "" })).toMatchObject({ ok: true });
    expect(validate({ limit: "  " })).toMatchObject({ ok: true });
    // Blank coordinates count as absent, same convention as limit.
    expect(validate({ lat: "", lng: "" })).toMatchObject({ ok: true });
  });

  it("rejects out-of-range lat/lng with the API's 400 contract", () => {
    expect(validate({ lat: "999", lng: "103.8" })).toEqual({
      ok: false,
      error: "lat",
      status: 400,
      code: "invalid_request",
      message: "lat must be a number within [-90, 90]",
    });
    expect(validate({ lat: "-91", lng: "103.8" })).toMatchObject({ ok: false, error: "lat" });
    expect(validate({ lat: "1.3", lng: "181" })).toMatchObject({ ok: false, error: "lng" });
    expect(validate({ lat: "1.3", lng: "-180.5" })).toMatchObject({ ok: false, error: "lng" });
    // Boundary values stay valid.
    expect(validate({ lat: "90", lng: "-180" })).toMatchObject({ ok: true });
  });

  it("rejects a present-but-unparseable coordinate — never silently dropped (BRAWUKA-670)", () => {
    // Malformed lat reports "lat" whether or not lng is present.
    const malformed: Record<string, string>[] = [
      { lat: "abc" },
      { lat: "abc", lng: "103.8" },
      { lat: "abc", lng: "def" },
      { lat: "Infinity", lng: "103.8" },
    ];
    for (const entries of malformed) {
      expect(validate(entries)).toMatchObject({ ok: false, error: "lat", status: 400 });
    }
    expect(validate({ lat: "1.3", lng: "def" })).toMatchObject({
      ok: false,
      error: "lng",
      status: 400,
      code: "invalid_request",
      message: "lng must be a number within [-180, 180]",
    });
  });

  it("rejects a lone coordinate — lat/lng must arrive as a pair (BRAWUKA-597)", () => {
    // Pairing is checked on raw presence: a blank half counts as absent, so
    // `?lat=&lng=103.8` is still a lone coordinate (BRAWUKA-670).
    const lone: Record<string, string>[] = [
      { lat: "1.3" },
      { lng: "103.8" },
      { lat: "", lng: "103.8" },
    ];
    for (const entries of lone) {
      expect(validate(entries)).toMatchObject({
        ok: false,
        error: "lat_lng",
        status: 400,
        code: "invalid_request",
        message: "lat and lng must be provided together",
      });
    }
    // Both present or both absent stay valid.
    expect(validate({ lat: "1.3", lng: "103.8" })).toMatchObject({ ok: true });
    expect(validate({})).toMatchObject({ ok: true });
  });

  it("rejects non-numeric, non-integer, and non-positive limit", () => {
    for (const limit of ["abc", "3.5", "0", "-5"]) {
      expect(validate({ limit })).toMatchObject({
        ok: false,
        error: "limit",
        status: 400,
        code: "invalid_request",
        message: "limit must be a positive integer",
      });
    }
  });

  it("rejects unknown explicit city (DG128)", () => {
    expect(validate({ city: "atlantis" })).toMatchObject({
      ok: false,
      error: "city",
      message: "unknown city",
    });
  });

  it("checks in API order: lat, lng, pairing, limit, then city", () => {
    expect(
      validate({ lat: "999", lng: "999", limit: "abc", city: "atlantis" }),
    ).toMatchObject({ ok: false, error: "lat" });
    expect(validate({ lng: "999", limit: "abc", city: "atlantis" })).toMatchObject({
      ok: false,
      error: "lng",
    });
    // Malformed and out-of-range values report their own error before
    // pairing: `lat=abc` alone is "lat", not "lat_lng" (BRAWUKA-670).
    expect(validate({ lat: "abc" })).toMatchObject({ ok: false, error: "lat" });
    expect(validate({ lat: "999" })).toMatchObject({ ok: false, error: "lat" });
    expect(validate({ lat: "1.3", limit: "abc", city: "atlantis" })).toMatchObject({
      ok: false,
      error: "lat_lng",
    });
    expect(validate({ limit: "abc", city: "atlantis" })).toMatchObject({
      ok: false,
      error: "limit",
    });
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
