/**
 * BRAWUKA-1020 — `Retry-After` is parsed uncapped, and each retry policy
 * bounds its own wait. The query policy keeps the 30 s guard (a background
 * query must not park for minutes); the like toggle waits out the full
 * header so a 45 s edge window is not re-entered at 30 s.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError, parseRetryAfterMs, RETRY_AFTER_CAP_MS } from "@/lib/http";
import { queryRetryDelay } from "@/lib/query/retry";

describe("parseRetryAfterMs", () => {
  it("returns the server's full delay, not a clipped one", () => {
    expect(parseRetryAfterMs("45")).toBe(45_000);
    expect(parseRetryAfterMs("120")).toBe(120_000);
  });

  it("reads an HTTP-date as the remaining delay", () => {
    const at = 12.5;
    expect(parseRetryAfterMs(new Date(Date.now() + at * 1000).toUTCString())).toBeGreaterThan(
      0,
    );
  });

  it("parses an HTTP-date exactly at the 32-bit timer ceiling", () => {
    const ceiling = 2 ** 31 - 1;
    // HTTP-dates carry whole seconds; the .353 offset makes the truncated
    // target minus `Date.now()` land on exactly 2,147,483,647 ms.
    vi.useFakeTimers({ now: Date.parse("2026-11-19T00:00:00.353Z") });
    try {
      const header = new Date(Date.now() + ceiling).toUTCString();
      expect(parseRetryAfterMs(header)).toBe(ceiling);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns undefined for absent, malformed, and non-positive values", () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    expect(parseRetryAfterMs("0")).toBeUndefined();
    expect(
      parseRetryAfterMs(new Date(Date.now() - 60_000).toUTCString()),
    ).toBeUndefined();
  });
});

describe("queryRetryDelay", () => {
  it("bounds a server-supplied wait at RETRY_AFTER_CAP_MS", () => {
    const error = new ApiError({ status: 429, code: "rate_limited", retryAfterMs: 45_000 });
    expect(queryRetryDelay(0, error)).toBe(RETRY_AFTER_CAP_MS);
  });

  it("honors a wait shorter than the cap", () => {
    const error = new ApiError({ status: 429, code: "rate_limited", retryAfterMs: 5_000 });
    expect(queryRetryDelay(0, error)).toBe(5_000);
  });
});
