import { describe, expect, it } from "vitest";
import { haversineKm } from "../src/geo";

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
  });

  it("approx matches SF ↔ LA (~559 km)", () => {
    const d = haversineKm(37.7749, -122.4194, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(540);
    expect(d).toBeLessThan(580);
  });

  it("is symmetric", () => {
    const a = haversineKm(1.35, 103.82, 48.8566, 2.3522);
    const b = haversineKm(48.8566, 2.3522, 1.35, 103.82);
    expect(a).toBeCloseTo(b, 10);
  });

  it("handles antipodal-ish distance (roughly half circumference)", () => {
    const d = haversineKm(0, 0, 0, 180);
    expect(d).toBeGreaterThan(19900);
    expect(d).toBeLessThan(20100);
  });
});