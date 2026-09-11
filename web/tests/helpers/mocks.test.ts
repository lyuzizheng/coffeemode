import { describe, expect, it } from "vitest";
import {
  createFakeImageUpload,
  createMockGooglePlacesResponse,
  createTestSessionUser,
} from "./mocks";
import { decodeFakeJwt } from "./auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("journey mock factories (spec 0007 §10)", () => {
  it("POI mock matches the searchExternalPOIs response shape with Google hits", () => {
    const res = createMockGooglePlacesResponse();
    expect(res.results).toHaveLength(2);
    for (const poi of res.results) {
      expect(poi.source).toBe("google");
      expect(poi.place_id).toMatch(/^ChIJ/);
      expect(poi.types).toContain("cafe");
      expect(poi.address).toBeTruthy();
      expect(poi.photo_refs.length).toBeGreaterThan(0);
      expect(() =>
        JSON.parse(poi.hours_json as string),
      ).not.toThrow();
      expect(new Date(poi.fetched_at).toISOString()).toBe(poi.fetched_at);
    }
    // Distinct hits so multi-POI tests do not collide.
    expect(res.results[0].place_id).not.toBe(res.results[1].place_id);
  });

  it("POI overrides merge into every hit", () => {
    const res = createMockGooglePlacesResponse({ name: "Override Cafe" });
    expect(res.results.every((poi) => poi.name === "Override Cafe")).toBe(true);
    expect(res.results[0].source).toBe("google");
  });

  it("fake image upload is a minimal valid WebP with a fresh v4 uuid", () => {
    const upload = createFakeImageUpload();
    expect(upload.imageUuid).toMatch(UUID_RE);
    expect(upload.contentType).toBe("image/webp");
    expect(upload.filename).toBe(`${upload.imageUuid}.webp`);
    expect(upload.size).toBe(upload.buffer.byteLength);
    const magic = Buffer.from(upload.buffer.slice(0, 12)).toString("binary");
    expect(magic.startsWith("RIFF")).toBe(true);
    expect(magic.endsWith("WEBP")).toBe(true);
  });

  it("fake image upload passes a custom buffer through unchanged", () => {
    const custom = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const upload = createFakeImageUpload(custom);
    expect(upload.buffer).toBe(custom);
    expect(upload.size).toBe(4);
  });

  it("session user carries defaults, overrides, and a matching JWT", () => {
    const user = createTestSessionUser();
    expect(user.id).toMatch(UUID_RE);
    expect(decodeFakeJwt(user.jwt).sub).toBe(user.id);

    const fixed = createTestSessionUser({
      id: "b0000000-0000-4000-a000-0000000000a1",
      displayName: "Journey Ann",
      currentCity: "tokyo",
    });
    expect(fixed.id).toBe("b0000000-0000-4000-a000-0000000000a1");
    expect(fixed.displayName).toBe("Journey Ann");
    expect(fixed.currentCity).toBe("tokyo");
    expect(decodeFakeJwt(fixed.jwt).sub).toBe(fixed.id);
  });
});
