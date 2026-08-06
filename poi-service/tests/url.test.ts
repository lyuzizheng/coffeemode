import { describe, expect, it } from "vitest";
import {
  extractCoords,
  extractPlaceId,
  extractQuery,
  isShortLink,
  parseMapsUrl,
  resolveShareUrl,
} from "../src/url";
import { mockFetch } from "./helpers";

const CANONICAL = "https://www.google.com/maps/place/UCC+Tokyo/@35.6580,139.7016,17z/data=!4m6!3m5!1s0x60188b9d2f2a2b79:0x9f2c0f1d2e3a4b5c!8m2!3d35.6580!4d139.7016!16s%2Fg%2F11bx55v";

describe("extractPlaceId", () => {
  it("extracts 0x… hex id from canonical place URLs", () => {
    expect(extractPlaceId(CANONICAL)).toBe("0x60188b9d2f2a2b79:0x9f2c0f1d2e3a4b5c");
  });

  it("extracts ChIJ-format id from path or params", () => {
    expect(extractPlaceId("https://www.google.com/maps/place/ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe(
      "ChIJN1t_tDeuEmsRUsoyG83frY4",
    );
  });

  it("returns null when no place id present", () => {
    expect(extractPlaceId("https://www.google.com/maps/search/coffee/@1.35,103.8,15z")).toBeNull();
  });
});

describe("extractCoords", () => {
  it("extracts @lat,lng", () => {
    expect(extractCoords("https://maps.google.com/?q=1.3521,103.8198&z=15")).toEqual({
      lat: 1.3521,
      lng: 103.8198,
    });
  });

  it("extracts !3d…!4d… tokens", () => {
    expect(extractCoords("...data=!4m6!3m5!1s0x0!8m2!3d35.6580!4d139.7016")).toEqual({
      lat: 35.658,
      lng: 139.7016,
    });
  });

  it("returns null for non-coordinate URLs", () => {
    expect(extractCoords("https://www.google.com/maps/search/coffee")).toBeNull();
  });
});

describe("extractQuery", () => {
  it("extracts ?q= params", () => {
    expect(extractQuery("https://www.google.com/maps?q=blue+bottle+coffee")).toBe(
      "blue bottle coffee",
    );
  });

  it("extracts /maps/search/ slugs", () => {
    expect(extractQuery("https://www.google.com/maps/search/UCC+Tokyo/@1.3,103.8,14z")).toBe(
      "UCC Tokyo",
    );
  });

  it("extracts place-name slugs", () => {
    expect(extractQuery("https://www.google.com/maps/place/UCC+Tokyo/@1.3,103.8,14z")).toBe(
      "UCC Tokyo",
    );
  });
});

describe("isShortLink", () => {
  it("detects goo.gl and maps.app.goo.gl", () => {
    expect(isShortLink("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isShortLink("https://goo.gl/maps/abc123")).toBe(true);
    expect(isShortLink(CANONICAL)).toBe(false);
  });
});

describe("parseMapsUrl", () => {
  it("prefers place id over coords/query", () => {
    const t = parseMapsUrl(CANONICAL);
    expect(t.placeId).toBe("0x60188b9d2f2a2b79:0x9f2c0f1d2e3a4b5c");
  });

  it("returns coords and query for search links", () => {
    const t = parseMapsUrl("https://www.google.com/maps/search/UCC+Tokyo/@1.35,103.82,14z");
    expect(t.placeId).toBeUndefined();
    expect(t.coords).toEqual({ lat: 1.35, lng: 103.82 });
    expect(t.query).toBe("UCC Tokyo");
  });
});

describe("resolveShareUrl", () => {
  it("follows short-link redirects to the canonical URL", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("https://maps.app.goo.gl/abc123");
      return new Response(null, {
        status: 302,
        headers: { location: CANONICAL },
      });
    });
    const target = await resolveShareUrl("https://maps.app.goo.gl/abc123", fetchImpl);
    expect(target.placeId).toBe("0x60188b9d2f2a2b79:0x9f2c0f1d2e3a4b5c");
  });

  it("stops after 5 hops without a place id", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(null, { status: 302, headers: { location: "https://maps.app.goo.gl/next" } }),
    );
    const target = await resolveShareUrl("https://maps.app.goo.gl/start", fetchImpl);
    expect(target.placeId).toBeUndefined();
  });

  it("returns parsed target directly for non-short links", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 599 }));
    const target = await resolveShareUrl(CANONICAL, fetchImpl);
    expect(target.placeId).toBe("0x60188b9d2f2a2b79:0x9f2c0f1d2e3a4b5c");
  });
});