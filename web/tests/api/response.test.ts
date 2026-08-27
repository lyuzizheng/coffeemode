import { describe, expect, it } from "vitest";
import { apiError, parseQueryPositiveInt } from "@/lib/api/response";

describe("apiError", () => {
  it("creates error response with default 400 and no message", async () => {
    const res = apiError("invalid_request");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("creates error response with status code number", async () => {
    const res = apiError("unauthorized", 401);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("creates error response with message and status code", async () => {
    const res = apiError("invalid_request", "id must be a UUID", 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request", message: "id must be a UUID" });
  });

  it("creates error response with extra fields", async () => {
    const res = apiError("cafe_exists", 409, { cafe_id: "abc-123" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cafe_exists", cafe_id: "abc-123" });
  });

  it("creates error response with message, status, and extra fields", async () => {
    const res = apiError("cafe_exists", "Cafe already exists", 409, { cafe_id: "abc-123" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "cafe_exists",
      message: "Cafe already exists",
      cafe_id: "abc-123",
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
