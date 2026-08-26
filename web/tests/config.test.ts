import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  appConfig,
  parseAppConfig,
  parseRateLimits,
  rateLimitBuckets,
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
    expect(appConfig.search.defaultSuggestionLimit).toBe(10);
    expect(appConfig.search.maxSuggestionLimit).toBe(10);
    expect(appConfig.search.weakResultsThreshold).toBe(3);
    expect(appConfig.search.dbFetchCap).toBe(100);
    expect(appConfig.cafes.listLimitMax).toBe(50);
    expect(appConfig.checkins.photoCap).toBe(6);
    expect(appConfig.checkins.noteMaxChars).toBe(500);
  });

  it("owns the feed page size (spec 0001: 20 per page, both modes)", () => {
    expect(appConfig.feed.pageSize).toBe(20);
  });

  it("owns the discovery fallback center (DG112: no geolocation prompt)", () => {
    expect(appConfig.discovery.defaultCenter).toEqual({ lat: 1.35, lng: 103.8 });
  });

  it("owns the SEO shell-cache TTLs and recovery limit (DG105/DG107/DG111)", () => {
    expect(appConfig.seo.shellCache).toEqual({
      sMaxAgeSeconds: 600,
      staleWhileRevalidateSeconds: 3600,
    });
    expect(appConfig.seo.recoveryLimit).toBe(5);
  });

  it("rateLimitConfig throws on an unknown bucket", () => {
    expect(() => rateLimitConfig("nope")).toThrow(/unknown rate limit "nope"/);
  });

  it("owns the search + profile rate limits (DG129, #216)", () => {
    expect(rateLimitBuckets("search")).toEqual([
      { windowMs: 60_000, maxRequests: 30 },
      { windowMs: 3_600_000, maxRequests: 100 },
      { windowMs: 86_400_000, maxRequests: 200 },
    ]);
    expect(rateLimitConfig("profile-read")).toEqual({ windowMs: 60_000, maxRequests: 30 });
    expect(rateLimitConfig("profile-write")).toEqual({ windowMs: 60_000, maxRequests: 10 });
    expect(() => rateLimitConfig("search")).toThrow(/multi-window/);
  });
});

describe("parseRateLimits validation", () => {
  it("accepts a valid table", () => {
    expect(parseRateLimits({ x: { windowMs: 1000, maxRequests: 5 } })).toEqual({
      x: { windowMs: 1000, maxRequests: 5 },
    });
  });

  it("accepts a multi-window (list) bucket", () => {
    expect(
      parseRateLimits({
        search: [
          { windowMs: 60_000, maxRequests: 30 },
          { windowMs: 3_600_000, maxRequests: 100 },
        ],
      }),
    ).toEqual({
      search: [
        { windowMs: 60_000, maxRequests: 30 },
        { windowMs: 3_600_000, maxRequests: 100 },
      ],
    });
  });

  it("rejects a non-mapping bucket", () => {
    expect(() => parseRateLimits({ x: 5 })).toThrow(/"x" must be a mapping/);
  });

  it("rejects a missing windowMs", () => {
    expect(() => parseRateLimits({ x: { maxRequests: 5 } })).toThrow(/"x\.windowMs"/);
  });

  it("rejects an empty list bucket", () => {
    expect(() => parseRateLimits({ search: [] })).toThrow(/non-empty list/);
  });

  it("rejects a non-positive maxRequests", () => {
    expect(() => parseRateLimits({ x: { windowMs: 1000, maxRequests: 0 } })).toThrow(
      /"x\.maxRequests" must be a positive number/,
    );
  });
});

describe("parseAppConfig validation", () => {
  const validSearch = {
    maxRadiusKm: 10,
    defaultSuggestionLimit: 10,
    maxSuggestionLimit: 10,
    weakResultsThreshold: 3,
    dbFetchCap: 100,
  };
  const validCenter = { defaultCenter: { lat: 1.35, lng: 103.8 } };
  const validSeo = {
    shellCache: { sMaxAgeSeconds: 600, staleWhileRevalidateSeconds: 3600 },
    recoveryLimit: 5,
  };
  const validCheckins = { photoCap: 6, noteMaxChars: 500 };

  it("accepts a valid config", () => {
    const valid = {
      search: validSearch,
      cafes: { listLimitMax: 50 },
      feed: { pageSize: 20 },
      discovery: validCenter,
      seo: validSeo,
      checkins: validCheckins,
    };
    expect(parseAppConfig(valid)).toEqual(valid);
  });

  it("rejects a missing section", () => {
    expect(() => parseAppConfig({ cafes: { listLimitMax: 50 } })).toThrow(/"search" must be a mapping/);
  });

  it("rejects a missing checkins section", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
      }),
    ).toThrow(/"checkins" must be a mapping/);
  });

  it("rejects a wrong type", () => {
    expect(() =>
      parseAppConfig({
        search: { ...validSearch, maxRadiusKm: "10" },
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: validCheckins,
      }),
    ).toThrow(/"search\.maxRadiusKm" must be a positive number/);
  });

  it("rejects an out-of-range discovery center", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: { defaultCenter: { lat: 135, lng: 103.8 } },
        seo: validSeo,
        checkins: validCheckins,
      }),
    ).toThrow(/"discovery\.defaultCenter\.lat" must be a number within \[-90,90\]/);
  });

  it("rejects a non-integer seo TTL", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: {
          shellCache: { sMaxAgeSeconds: 60.5, staleWhileRevalidateSeconds: 3600 },
          recoveryLimit: 5,
        },
        checkins: validCheckins,
      }),
    ).toThrow(/"seo\.shellCache\.sMaxAgeSeconds" must be a positive integer/);
  });

  it("rejects a non-integer checkins cap", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: { photoCap: 6.5, noteMaxChars: 500 },
      }),
    ).toThrow(/"checkins\.photoCap" must be a positive integer/);
  });
});
