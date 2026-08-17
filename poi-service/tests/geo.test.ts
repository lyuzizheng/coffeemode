import { describe, expect, it } from "vitest";
import { haversineKm, wrapLng } from "../src/geo";

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

describe("wrapLng", () => {
  it("passes through in-range longitudes", () => {
    expect(wrapLng(0)).toBe(0);
    expect(wrapLng(100)).toBe(100);
    expect(wrapLng(-179.9)).toBeCloseTo(-179.9, 10);
  });

  it("wraps values past ±180 into [-180, 180)", () => {
    expect(wrapLng(180.4)).toBeCloseTo(-179.6, 10);
    expect(wrapLng(-180.4)).toBeCloseTo(179.6, 10);
    expect(wrapLng(180)).toBe(-180);
    expect(wrapLng(540)).toBe(-180);
  });

  it("handles large excursions", () => {
    expect(wrapLng(360 + 10)).toBe(10);
    expect(wrapLng(-360 - 10)).toBe(-10);
  });
});