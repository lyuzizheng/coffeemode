import { describe, expect, it } from "vitest";
import { internalError, json, safeEqual, unauthorized, extractBearer } from "@shared/auth";
import { isValidUUID } from "@shared/uuid";
import { validateUploadSize } from "@shared/images/validation";
import { MAX_UPLOAD_BYTES } from "@shared/images/constants";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM } from "@shared/places/constants";
import type { POI } from "@shared/places/types";

/**
 * Unit tests for web/shared — the shared single-source module
 * (issue #26). Runs under the web package's vitest so the shared code has
 * a dedicated gate without adding a fourth test runner.
 */

describe("shared uuid", () => {
  it("accepts valid UUID v4 strings", () => {
    expect(isValidUUID("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")).toBe(true);
  });

  it("rejects non-UUID strings, wrong versions, and non-strings", () => {
    expect(isValidUUID("not-a-uuid")).toBe(false);
    expect(isValidUUID("a0eebc99-9c0b-6ef8-bb6d-6bb9bd380a11")).toBe(false); // v6
    expect(isValidUUID("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1")).toBe(false); // short
    expect(isValidUUID(123)).toBe(false);
    expect(isValidUUID(null)).toBe(false);
  });
});

describe("shared auth", () => {
  it("extracts from the service header first", () => {
    const req = new Request("https://x.test/", {
      headers: { "x-poi-service-token": "header-token", authorization: "Bearer auth-token" },
    });
    expect(extractBearer(req, "x-poi-service-token")).toBe("header-token");
  });

  it("extracts Bearer tokens case-insensitively per RFC 6750", () => {
    const req = new Request("https://x.test/", {
      headers: { authorization: "bEaReR abc123" },
    });
    expect(extractBearer(req, "x-poi-service-token")).toBe("abc123");
  });

  it("returns null when no token is present", () => {
    expect(extractBearer(new Request("https://x.test/"), "x-image-service-token")).toBeNull();
  });

  it("compares tokens in constant time (equal and unequal)", () => {
    expect(safeEqual("secret-token", "secret-token")).toBe(true);
    expect(safeEqual("secret-token", "wrong-token")).toBe(false);
    expect(safeEqual("short", "a-much-longer-token")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("shares the JSON error envelope", () => {
    expect(unauthorized().status).toBe(401);
    expect(internalError().status).toBe(500);
    expect(json({ a: 1 }).headers.get("content-type")).toContain("application/json");
  });
});

describe("shared upload size validation", () => {
  it("requires size", () => {
    expect(validateUploadSize(undefined)).toMatchObject({ ok: false, code: "missing" });
  });

  it("rejects non-finite, non-positive, and non-integer sizes", () => {
    expect(validateUploadSize("10")).toMatchObject({ ok: false, code: "invalid" });
    expect(validateUploadSize(0)).toMatchObject({ ok: false, code: "invalid" });
    expect(validateUploadSize(Number.NaN)).toMatchObject({ ok: false, code: "invalid" });
    expect(validateUploadSize(10.5)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("rejects sizes over the shared cap", () => {
    const result = validateUploadSize(MAX_UPLOAD_BYTES + 1);
    expect(result).toMatchObject({ ok: false, code: "size_exceeded" });
  });

  it("accepts the cap and anything under it", () => {
    expect(validateUploadSize(MAX_UPLOAD_BYTES)).toEqual({ ok: true, size: MAX_UPLOAD_BYTES });
    expect(validateUploadSize(1024)).toEqual({ ok: true, size: 1024 });
  });
});

describe("shared constants", () => {
  it("pins the product default search radius to 10 km", () => {
    expect(DEFAULT_SEARCH_RADIUS_KM).toBe(10);
    expect(MAX_SEARCH_RADIUS_KM).toBe(200);
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  it("exports a POI type usable as a value-free contract", () => {
    const poi: POI = {
      place_id: "ChIJTEST",
      source: "google",
      name: "Test",
      lat: 1,
      lng: 2,
      address: null,
      types: [],
      business_status: null,
      hours_json: null,
      photo_refs: [],
      fetched_at: "2026-08-09T00:00:00.000Z",
    };
    expect(poi.source).toBe("google");
  });
});
