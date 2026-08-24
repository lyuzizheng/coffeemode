import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  appConfig,
  parseAppConfig,
  parseRateLimits,
  rateLimitConfig,
  rateLimits,
} from "@/lib/config";

// The app-config slice (DG107): product parameters live in web/config/*.yaml
// and are read through typed helpers. These tests pin the schema validation
// and prove the migration kept the previously hardcoded values.

function loadRaw(file: string): unknown {
  return parse(readFileSync(path.join(process.cwd(), "config", file), "utf8")) as unknown;
}

describe("config files", () => {
  it("rateLimits matches rate-limits.yaml", () => {
    expect(rateLimits).toEqual(parseRateLimits(loadRaw("rate-limits.yaml")));
  });

  it("appConfig matches app.yaml", () => {
    expect(appConfig).toEqual(parseAppConfig(loadRaw("app.yaml")));
  });

  it("keeps the previously hardcoded rate-limit values (no behavior change)", () => {
    expect(rateLimitConfig("images")).toEqual({ windowMs: 60_000, maxRequests: 10 });
    expect(rateLimitConfig("places")).toEqual({ windowMs: 60_000, maxRequests: 30 });
    expect(rateLimitConfig("cafes-read")).toEqual({ windowMs: 60_000, maxRequests: 30 });
    expect(rateLimitConfig("cafes-write")).toEqual({ windowMs: 60_000, maxRequests: 10 });
  });

  it("keeps the previously hardcoded app parameter values", () => {
    expect(appConfig.search.maxRadiusKm).toBe(10);
    expect(appConfig.cafes.listLimitMax).toBe(50);
  });

  it("owns the feed page size (spec 0001: 20 per page, both modes)", () => {
    expect(appConfig.feed.pageSize).toBe(20);
  });

  it("owns the discovery fallback center (DG112: no geolocation prompt)", () => {
    expect(appConfig.discovery.defaultCenter).toEqual({ lat: 1.35, lng: 103.8 });
  });

  it("rateLimitConfig throws on an unknown bucket", () => {
    expect(() => rateLimitConfig("nope")).toThrow(/unknown rate limit "nope"/);
  });
});

describe("parseRateLimits validation", () => {
  it("accepts a valid table", () => {
    expect(parseRateLimits({ x: { windowMs: 1000, maxRequests: 5 } })).toEqual({
      x: { windowMs: 1000, maxRequests: 5 },
    });
  });

  it("rejects a non-mapping bucket", () => {
    expect(() => parseRateLimits({ x: 5 })).toThrow(/"x" must be a mapping/);
  });

  it("rejects a missing windowMs", () => {
    expect(() => parseRateLimits({ x: { maxRequests: 5 } })).toThrow(/"x\.windowMs"/);
  });

  it("rejects a non-positive maxRequests", () => {
    expect(() => parseRateLimits({ x: { windowMs: 1000, maxRequests: 0 } })).toThrow(
      /"x\.maxRequests" must be a positive number/,
    );
  });
});

describe("parseAppConfig validation", () => {
  const validCenter = { defaultCenter: { lat: 1.35, lng: 103.8 } };

  it("accepts a valid config", () => {
    const valid = {
      search: { maxRadiusKm: 10 },
      cafes: { listLimitMax: 50 },
      feed: { pageSize: 20 },
      discovery: validCenter,
    };
    expect(parseAppConfig(valid)).toEqual(valid);
  });

  it("rejects a missing section", () => {
    expect(() => parseAppConfig({ cafes: { listLimitMax: 50 } })).toThrow(/"search" must be a mapping/);
  });

  it("rejects a wrong type", () => {
    expect(() =>
      parseAppConfig({
        search: { maxRadiusKm: "10" },
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
      }),
    ).toThrow(/"search\.maxRadiusKm" must be a positive number/);
  });

  it("rejects an out-of-range discovery center", () => {
    expect(() =>
      parseAppConfig({
        search: { maxRadiusKm: 10 },
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: { defaultCenter: { lat: 135, lng: 103.8 } },
      }),
    ).toThrow(/"discovery\.defaultCenter\.lat" must be a number within \[-90,90\]/);
  });
});
