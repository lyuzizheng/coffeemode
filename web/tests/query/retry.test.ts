import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/http";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/query/retry";

const apiError = (status: number, init?: { retryAfterMs?: number }) =>
  new ApiError({ status, code: "internal_error", ...init });

describe("shouldRetryQuery (spec 0011 D9)", () => {
  it("retries network failures up to two attempts when online", () => {
    const network = new TypeError("Failed to fetch");
    expect(shouldRetryQuery(0, network, true)).toBe(true);
    expect(shouldRetryQuery(1, network, true)).toBe(true);
    expect(shouldRetryQuery(2, network, true)).toBe(false);
  });

  it("never retries when offline — cached data or nothing", () => {
    expect(shouldRetryQuery(0, new TypeError("Failed to fetch"), false)).toBe(false);
    expect(shouldRetryQuery(1, apiError(500), false)).toBe(false);
    expect(shouldRetryQuery(5, apiError(503), false)).toBe(false);
  });

  it("never retries 4xx — the caller cannot fix the request by resending", () => {
    for (const status of [401, 403, 404, 422]) {
      expect(shouldRetryQuery(0, apiError(status), true)).toBe(false);
      expect(shouldRetryQuery(1, apiError(status), true)).toBe(false);
    }
  });

  it("retries 429 exactly once — the Retry-After wait lives in queryRetryDelay", () => {
    expect(shouldRetryQuery(0, apiError(429, { retryAfterMs: 5000 }), true)).toBe(true);
    expect(shouldRetryQuery(1, apiError(429, { retryAfterMs: 5000 }), true)).toBe(false);
  });

  it("retries 5xx up to two attempts", () => {
    expect(shouldRetryQuery(0, apiError(500), true)).toBe(true);
    expect(shouldRetryQuery(1, apiError(502), true)).toBe(true);
    expect(shouldRetryQuery(2, apiError(503), true)).toBe(false);
  });
});

describe("queryRetryDelay", () => {
  it("honors the server's Retry-After on 429", () => {
    expect(queryRetryDelay(0, apiError(429, { retryAfterMs: 7000 }))).toBe(7000);
  });

  it("falls back to exponential backoff for everything else", () => {
    expect(queryRetryDelay(0, apiError(500))).toBe(1000);
    expect(queryRetryDelay(1, apiError(500))).toBe(2000);
    expect(queryRetryDelay(0, new TypeError("Failed to fetch"))).toBe(1000);
  });
});
