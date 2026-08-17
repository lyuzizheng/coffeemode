import { describe, expect, it } from "vitest";
import {
  extractCoords,
  extractPlaceId,
  extractQuery,
  isMapsHost,
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

describe("isMapsHost", () => {
  it("accepts short-link, apple, and google.* hosts (www/maps prefixes, regional TLDs)", () => {
    for (const h of [
      "goo.gl",
      "maps.app.goo.gl",
      "maps.apple.com",
      "google.com",
      "www.google.com",
      "maps.google.com",
      "www.google.co.uk",
      "maps.google.de",
      "google.com.sg",
      "WWW.GOOGLE.COM",
    ]) {
      expect(isMapsHost(h)).toBe(true);
    }
  });

  it("rejects non-map subdomains and lookalikes (issue #37)", () => {
    for (const h of [
      "drive.google.com",
      "mail.google.com",
      "photos.google.com",
      "foo.google.com",
      "google.com.evil.com",
      "maps.apple.com.evil.com",
      "evilgoogle.com",
      "apple.com",
      "example.com",
      // attacker-registrable TLD shapes
      "google.evil.io",
      "google.attacker.co",
      "google.zip",
      "google.mov",
    ]) {
      expect(isMapsHost(h)).toBe(false);
    }
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

  it("rejects a non-maps initial URL even when it embeds a place-id pattern (issue #37)", async () => {
    const fetchImpl = mockFetch(() => new Response("must not be fetched", { status: 500 }));
    const target = await resolveShareUrl(
      "https://evil.com/maps/place/x/data=!4m6!3m5!1s0x8085:0x9f2c",
      fetchImpl,
    );
    expect(target).toEqual({});
  });

  it("rejects non-https initial URLs", async () => {
    const target = await resolveShareUrl(
      "http://www.google.com/maps/place/x/data=!4m6!3m5!1s0x8085:0x9f2c",
      mockFetch(() => new Response(null, { status: 599 })),
    );
    expect(target).toEqual({});
  });

  it("stops when a short link redirects off the maps allowlist", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url === "https://maps.app.goo.gl/xyz") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.com/maps/place/x/data=!4m6!3m5!1s0x8085:0x9f2c" },
        });
      }
      return new Response("must not be fetched", { status: 500 });
    });
    const target = await resolveShareUrl("https://maps.app.goo.gl/xyz", fetchImpl);
    expect(target.placeId).toBeUndefined();
  });

  it("refuses https → http downgrades in redirects", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(null, {
        status: 302,
        headers: { location: "http://www.google.com/maps/place/x/data=!4m6!3m5!1s0x8085:0x9f2c" },
      }),
    );
    const target = await resolveShareUrl("https://maps.app.goo.gl/xyz", fetchImpl);
    expect(target.placeId).toBeUndefined();
  });

  it("stops gracefully on a malformed Location header instead of throwing", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(null, { status: 302, headers: { location: "http://[::1" } }),
    );
    const target = await resolveShareUrl("https://maps.app.goo.gl/xyz", fetchImpl);
    expect(target.placeId).toBeUndefined();
  });

  it("follows relative Location headers that stay on the short-link host", async () => {
    const fetchImpl = mockFetch(() =>
      new Response(null, {
        status: 302,
        headers: { location: "/p/data=!4m6!3m5!1s0x8085:0x9f2c" },
      }),
    );
    const target = await resolveShareUrl("https://maps.app.goo.gl/xyz", fetchImpl);
    expect(target.placeId).toBe("0x8085:0x9f2c");
  });

  it("follows short → short → canonical chains", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url === "https://goo.gl/maps/a") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://maps.app.goo.gl/b" },
        });
      }
      if (url === "https://maps.app.goo.gl/b") {
        return new Response(null, { status: 302, headers: { location: CANONICAL } });
      }
      return new Response("unexpected fetch", { status: 500 });
    });
    const target = await resolveShareUrl("https://goo.gl/maps/a", fetchImpl);
    expect(target.placeId).toBe("0x60188b9d2f2a2b79:0x9f2c0f1d2e3a4b5c");
  });

  it("rejects userinfo URLs whose real host is off the allowlist", async () => {
    const target = await resolveShareUrl(
      "https://www.google.com@evil.com/maps/place/x/data=!4m6!3m5!1s0x8085:0x9f2c",
      mockFetch(() => new Response("must not be fetched", { status: 500 })),
    );
    expect(target).toEqual({});
  });
});