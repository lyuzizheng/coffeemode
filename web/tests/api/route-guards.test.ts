import { describe, it, expect } from "vitest";
import { checkRouteGuards } from "../../scripts/check-route-guards.mjs";
import { resolve } from "node:path";

describe("Route guard enforcement (BRAWUKA-181 / B-STD-2)", () => {
  const webRoot = resolve(process.cwd());
  it("exports checkRouteGuards function", () => {
    expect(typeof checkRouteGuards).toBe("function");
  });
  it("verifies all current API routes properly invoke guard() with no violations", () => {
    const violations = checkRouteGuards(webRoot);
    expect(violations).toEqual([]);
  });
});
