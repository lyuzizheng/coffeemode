import { describe, expect, it } from "vitest";
import {
  apiError,
  parseQueryBoolean,
  parseQueryNumber,
  parseQueryNumberOrNaN,
  parseQueryPositiveInt,
  parseQueryScore,
} from "@/lib/api/response";

describe("apiError", () => {
  it("uses the registry status when none is given", async () => {
    const res = apiError("invalid_request");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects unregistered codes at typecheck", () => {
    // @ts-expect-error unregistered codes are not in ERROR_CODES
    expect(() => apiError("unregistered_code")).toThrow();
  });

  it("creates error response with status code number", async () => {
    const res = apiError("unauthorized", 401);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("creates error response with message and status code", async () => {
    const res = apiError("invalid_request", "id must be a UUID", { status: 400 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request", message: "id must be a UUID" });
  });

  it("creates error response with extra fields mirrored into details", async () => {
    const res = apiError("cafe_exists", 409, { extra: { cafe_id: "abc-123" } });
    expect(res.status).toBe(409);
    // Legacy top-level extras stay for one release; details carries the same
    // keys for new clients (spec 0011 D2).
    expect(await res.json()).toEqual({
      error: "cafe_exists",
      cafe_id: "abc-123",
      details: { cafe_id: "abc-123" },
    });
  });

  it("creates error response with message, status, and extra fields", async () => {
    const res = apiError("cafe_exists", "Cafe already exists", {
      status: 409,
      extra: { cafe_id: "abc-123" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "cafe_exists",
      message: "Cafe already exists",
      cafe_id: "abc-123",
      details: { cafe_id: "abc-123" },
    });
  });

  it("merges extra fields through the message form and defaults to the registry status", async () => {
    const res = apiError("cafe_exists", "Cafe already exists", {
      extra: { cafe_id: "abc-123" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "cafe_exists",
      message: "Cafe already exists",
      cafe_id: "abc-123",
      details: { cafe_id: "abc-123" },
    });
  });

  it("lets explicit details win over mirrored extras", async () => {
    const res = apiError("duplicate_checkin", 409, {
      extra: { existing_checkin_id: "chk-1" },
      details: { fields: [{ field: "photos", reason: "unconsumed" }] },
    });
    expect(await res.json()).toEqual({
      error: "duplicate_checkin",
      existing_checkin_id: "chk-1",
      details: {
        existing_checkin_id: "chk-1",
        fields: [{ field: "photos", reason: "unconsumed" }],
      },
    });
  });

  it("emits request_id on 5xx even without a request in scope", async () => {
    const res = apiError("internal_error", 500);
    const body = await res.json();
    expect(body).toMatchObject({ error: "internal_error" });
    expect(typeof body.request_id).toBe("string");
  });

  it("echoes the inbound x-request-id when a request is in scope", async () => {
    const requestId = "123e4567-e89b-42d3-a456-426614174000";
    const request = new Request("http://localhost/api/test", {
      headers: { "x-request-id": requestId },
    });
    const res = apiError("forbidden", 403, { request });
    expect(await res.json()).toEqual({ error: "forbidden", request_id: requestId });
  });

  it("omits request_id on 4xx without a request in scope", async () => {
    const res = apiError("not_found", 404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("rejects a bare extra object as the third argument", () => {
    // @ts-expect-error extra fields must be named — a bare object is not a valid options bag
    apiError("cafe_exists", "Cafe already exists", { cafe_id: "abc-123" });
  });

  it("keeps envelope fields when extra carries error or message keys", async () => {
    const res = apiError("cafe_exists", "Cafe already exists", {
      extra: { error: "spoofed", message: "spoofed", cafe_id: "abc-123" },
    });
    expect(await res.json()).toEqual({
      error: "cafe_exists",
      message: "Cafe already exists",
      cafe_id: "abc-123",
      details: { error: "spoofed", message: "spoofed", cafe_id: "abc-123" },
    });
  });
});

describe("parseQueryPositiveInt", () => {
  it("returns default value when param is null", () => {
    expect(parseQueryPositiveInt(null, 20, 50)).toBe(20);
  });

  it("returns clamped value when valid integer", () => {
    expect(parseQueryPositiveInt("10", 20, 50)).toBe(10);
    expect(parseQueryPositiveInt("100", 20, 50)).toBe(50);
  });

  it("returns null for non-positive or malformed integers", () => {
    expect(parseQueryPositiveInt("0", 20, 50)).toBeNull();
    expect(parseQueryPositiveInt("-5", 20, 50)).toBeNull();
    expect(parseQueryPositiveInt("abc", 20, 50)).toBeNull();
    expect(parseQueryPositiveInt("10.5", 20, 50)).toBeNull();
  });
});

describe("parseQueryNumber", () => {
  it("returns undefined for absent, blank, and non-numeric input", () => {
    expect(parseQueryNumber(null)).toBeUndefined();
    expect(parseQueryNumber("")).toBeUndefined();
    expect(parseQueryNumber("   ")).toBeUndefined();
    expect(parseQueryNumber("abc")).toBeUndefined();
    expect(parseQueryNumber("12abc")).toBeUndefined();
  });

  it("returns undefined for non-finite input rather than Infinity", () => {
    expect(parseQueryNumber("Infinity")).toBeUndefined();
    expect(parseQueryNumber("-Infinity")).toBeUndefined();
    expect(parseQueryNumber("NaN")).toBeUndefined();
  });

  it("parses zero, negatives, decimals, and exponent notation", () => {
    expect(parseQueryNumber("0")).toBe(0);
    expect(parseQueryNumber("-3")).toBe(-3);
    expect(parseQueryNumber("12.5")).toBe(12.5);
    expect(parseQueryNumber("1e3")).toBe(1000);
  });
});

describe("parseQueryNumberOrNaN", () => {
  it("collapses absent, blank, and non-numeric input to NaN", () => {
    expect(parseQueryNumberOrNaN(null)).toBeNaN();
    expect(parseQueryNumberOrNaN("")).toBeNaN();
    expect(parseQueryNumberOrNaN("   ")).toBeNaN();
    expect(parseQueryNumberOrNaN("abc")).toBeNaN();
    expect(parseQueryNumberOrNaN("5km")).toBeNaN();
  });

  it("keeps Infinity distinct from absence", () => {
    expect(parseQueryNumberOrNaN("Infinity")).toBe(Infinity);
  });

  it("parses zero, negatives, and decimals", () => {
    expect(parseQueryNumberOrNaN("0")).toBe(0);
    expect(parseQueryNumberOrNaN("-2.5")).toBe(-2.5);
    expect(parseQueryNumberOrNaN("5")).toBe(5);
  });
});

describe("parseQueryScore", () => {
  it("returns undefined for absent, blank, non-numeric, and out-of-range input", () => {
    expect(parseQueryScore(null)).toBeUndefined();
    expect(parseQueryScore("")).toBeUndefined();
    expect(parseQueryScore("abc")).toBeUndefined();
    expect(parseQueryScore("-1")).toBeUndefined();
    expect(parseQueryScore("101")).toBeUndefined();
  });

  it("accepts the inclusive 0-100 boundaries", () => {
    expect(parseQueryScore("0")).toBe(0);
    expect(parseQueryScore("100")).toBe(100);
    expect(parseQueryScore("75")).toBe(75);
  });
});

describe("parseQueryBoolean", () => {
  it("returns undefined only when the parameter is absent", () => {
    expect(parseQueryBoolean(null)).toBeUndefined();
  });

  it("treats true and 1 as true", () => {
    expect(parseQueryBoolean("true")).toBe(true);
    expect(parseQueryBoolean("1")).toBe(true);
  });

  it("treats every other present value as false", () => {
    expect(parseQueryBoolean("false")).toBe(false);
    expect(parseQueryBoolean("0")).toBe(false);
    expect(parseQueryBoolean("")).toBe(false);
    expect(parseQueryBoolean("yes")).toBe(false);
  });
});
