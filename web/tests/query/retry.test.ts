import { describe, expect, it } from "vitest";
import { shouldRetryQuery } from "@/lib/query/retry";

describe("shouldRetryQuery", () => {
  it("retries up to two attempts when online", () => {
    expect(shouldRetryQuery(0, true)).toBe(true);
    expect(shouldRetryQuery(1, true)).toBe(true);
    expect(shouldRetryQuery(2, true)).toBe(false);
    expect(shouldRetryQuery(3, true)).toBe(false);
  });

  it("never retries when offline — cached data or nothing", () => {
    expect(shouldRetryQuery(0, false)).toBe(false);
    expect(shouldRetryQuery(1, false)).toBe(false);
    expect(shouldRetryQuery(5, false)).toBe(false);
  });
});
