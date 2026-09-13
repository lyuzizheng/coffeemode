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
    expect(appConfig.search.maxIterativeFetchBatches).toBe(10);
    expect(appConfig.search.minPoiQueryLength).toBe(3);
    expect(appConfig.search.relevanceWeights).toEqual({
      exactNameMatch: 100,
      prefixMatch: 80,
      fuzzyMatch: 50,
      secondaryMatch: 10,
    });
    expect(appConfig.search.minRelevanceScore).toBe(50);
    expect(appConfig.search.externalSources).toEqual({ google: true, apple: false });
    expect(appConfig.search.rankingMode).toBe("relevance");
    expect(appConfig.search.goodFirst).toEqual({ experienceMin: 80, compositeMin: 75, boost: 10 });
    expect(appConfig.search.responseCache).toEqual({ maxAgeSeconds: 10, staleWhileRevalidateSeconds: 30 });
    expect(appConfig.search.client).toEqual({ minQueryLength: 3, debounceMs: 400 });
    expect(appConfig.stats.dimWeights).toEqual({
      wifi: 0.3,
      outlets: 0.2,
      seats: 0.2,
      temp: 0.15,
      coffee: 0.15,
    });
    expect(appConfig.stats.recencyDecay).toBe(0.6);
    expect(appConfig.cafes.listLimitMax).toBe(50);
    expect(appConfig.checkins.photoCap).toBe(6);
    expect(appConfig.checkins.noteMaxChars).toBe(500);
    expect(appConfig.checkins.revisitWindowHours).toBe(24);
    expect(appConfig.profile.listLimitMax).toBe(50);
    expect(appConfig.profile.listPageSize).toBe(20);
    expect(appConfig.profile.displayNameMaxChars).toBe(24);
    expect(appConfig.profile.recentSearchesMax).toBe(20);
    expect(appConfig.profile.handle).toEqual({
      minChars: 3,
      maxChars: 30,
      changeCooldownDays: 7,
      slugMaxChars: 25,
      generateMaxAttempts: 10,
    });
    expect(appConfig.images).toEqual({
      maxOriginalDimension: 4096,
      webpQuality: 80,
      r2DownloadTimeoutMs: 30000,
      r2UploadTimeoutMs: 30000,
      downloadSlackBytes: 524288,
    });
    expect(appConfig.query).toEqual({
      staleTimeMs: 300000,
      gcTimeMs: 86400000,
      persistMaxAgeMs: 604800000,
    });
    expect(appConfig.validation).toEqual({ cafeAddressMaxChars: 300, profileCityMaxChars: 50 });
    expect(appConfig.budgets.bundle).toEqual({
      maxJsChunkBytes: 409600,
      maxCssChunkBytes: 512000,
      maxTotalStaticBytes: 5242880,
    });
    expect(appConfig.budgets.lighthouse).toEqual({
      performance: 0.8,
      accessibility: 0.85,
      bestPractices: 0.85,
      seo: 0.85,
    });
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
      cacheableStatuses: [200],
      bypassOnSetCookieResponse: true,
      bypassOnRequestCookiePrefixes: ["sb-"],
      varyHeaders: ["Accept-Language"],
      sharedCacheAcrossLocales: false,
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
    expect(rateLimitConfig("identity-write")).toEqual({ windowMs: 60_000, maxRequests: 10 });
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
    maxIterativeFetchBatches: 10,
    minPoiQueryLength: 3,
    relevanceWeights: {
      exactNameMatch: 100,
      prefixMatch: 80,
      fuzzyMatch: 50,
      secondaryMatch: 10,
    },
    minRelevanceScore: 50,
    externalSources: { google: true, apple: false },
    rankingMode: "relevance",
    goodFirst: { experienceMin: 80, compositeMin: 75, boost: 10 },
    responseCache: { maxAgeSeconds: 10, staleWhileRevalidateSeconds: 30 },
    client: { minQueryLength: 3, debounceMs: 400 },
  };
  const validStats = {
    dimWeights: {
      wifi: 0.3,
      outlets: 0.2,
      seats: 0.2,
      temp: 0.15,
      coffee: 0.15,
    },
    recencyDecay: 0.6,
  };
  const validCenter = { defaultCenter: { lat: 1.35, lng: 103.8 } };
  const validSeo = {
    shellCache: {
      sMaxAgeSeconds: 600,
      staleWhileRevalidateSeconds: 3600,
      cacheableStatuses: [200],
      bypassOnSetCookieResponse: true,
      bypassOnRequestCookiePrefixes: ["sb-"],
      varyHeaders: ["Accept-Language"],
      sharedCacheAcrossLocales: false,
    },
    recoveryLimit: 5,
  };
  const validCheckins = { photoCap: 6, noteMaxChars: 500, pendingDraftTtlHours: 72, revisitWindowHours: 24 };
  const validProfile = {
    listLimitMax: 50,
    listPageSize: 20,
    displayNameMaxChars: 24,
    recentSearchesMax: 20,
    handle: {
      minChars: 3,
      maxChars: 30,
      changeCooldownDays: 7,
      slugMaxChars: 25,
      generateMaxAttempts: 10,
    },
  };
  const validBudgets = {
    bundle: {
      maxJsChunkBytes: 409600,
      maxCssChunkBytes: 512000,
      maxTotalStaticBytes: 5242880,
    },
    lighthouse: {
      performance: 0.8,
      accessibility: 0.85,
      bestPractices: 0.85,
      seo: 0.85,
    },
  };
  const validImages = {
    maxOriginalDimension: 4096,
    webpQuality: 80,
    r2DownloadTimeoutMs: 30000,
    r2UploadTimeoutMs: 30000,
    downloadSlackBytes: 524288,
  };
  const validQuery = { staleTimeMs: 300000, gcTimeMs: 86400000, persistMaxAgeMs: 604800000 };
  const validValidation = { cafeAddressMaxChars: 300, profileCityMaxChars: 50 };

  it("accepts a valid config", () => {
    const valid = {
      search: validSearch,
      stats: validStats,
      cafes: { listLimitMax: 50 },
      feed: { pageSize: 20 },
      discovery: validCenter,
      seo: validSeo,
      checkins: validCheckins,
      profile: validProfile,
      images: validImages,
      query: validQuery,
      validation: validValidation,
      budgets: validBudgets,
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
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        profile: validProfile,
        budgets: validBudgets,
      }),
    ).toThrow(/"checkins" must be a mapping/);
  });

  it("rejects a missing profile section", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: validCheckins,
        budgets: validBudgets,
      }),
    ).toThrow(/"profile" must be a mapping/);
  });

  it("rejects a missing budgets section", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: validCheckins,
        profile: validProfile,
        images: validImages,
        query: validQuery,
        validation: validValidation,
      }),
    ).toThrow(/"budgets" must be a mapping/);
  });

  it("rejects a wrong type", () => {
    expect(() =>
      parseAppConfig({
        search: { ...validSearch, maxRadiusKm: "10" },
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: validCheckins,
        profile: validProfile,
        budgets: validBudgets,
      }),
    ).toThrow(/"search\.maxRadiusKm" must be a positive number/);
  });

  it("rejects an out-of-range discovery center", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: { defaultCenter: { lat: 135, lng: 103.8 } },
        seo: validSeo,
        checkins: validCheckins,
        profile: validProfile,
        budgets: validBudgets,
      }),
    ).toThrow(/"discovery\.defaultCenter\.lat" must be a number within \[-90,90\]/);
  });

  it("rejects a non-integer seo TTL", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: {
          shellCache: { sMaxAgeSeconds: 60.5, staleWhileRevalidateSeconds: 3600 },
          recoveryLimit: 5,
        },
        checkins: validCheckins,
        profile: validProfile,
        budgets: validBudgets,
      }),
    ).toThrow(/"seo\.shellCache\.sMaxAgeSeconds" must be a positive integer/);
  });

  it("rejects a non-integer checkins cap", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: { photoCap: 6.5, noteMaxChars: 500, pendingDraftTtlHours: 72 },
        profile: validProfile,
        budgets: validBudgets,
      }),
    ).toThrow(/"checkins\.photoCap" must be a positive integer/);
  });

  it("rejects a missing or non-positive revisit window (DG64)", () => {
    const base = {
      search: validSearch,
      stats: validStats,
      cafes: { listLimitMax: 50 },
      feed: { pageSize: 20 },
      discovery: validCenter,
      seo: validSeo,
      profile: validProfile,
      budgets: validBudgets,
    };
    expect(() =>
      parseAppConfig({ ...base, checkins: { photoCap: 6, noteMaxChars: 500, pendingDraftTtlHours: 72 } }),
    ).toThrow(/"checkins\.revisitWindowHours" must be a positive number/);
    expect(() =>
      parseAppConfig({ ...base, checkins: { photoCap: 6, noteMaxChars: 500, pendingDraftTtlHours: 72, revisitWindowHours: 0 } }),
    ).toThrow(/"checkins\.revisitWindowHours" must be a positive number/);
  });

  it("rejects an out-of-range lighthouse score threshold", () => {
    expect(() =>
      parseAppConfig({
        search: validSearch,
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: validCheckins,
        profile: validProfile,
        images: validImages,
        query: validQuery,
        validation: validValidation,
        budgets: {
          ...validBudgets,
          lighthouse: {
            ...validBudgets.lighthouse,
            performance: 1.5,
          },
        },
      }),
    ).toThrow(/"budgets\.lighthouse\.performance" must be a number between 0 and 1/);
  });

  it("rejects a missing or mistyped search.goodFirst (BRAWUKA-250)", () => {
    const base = {
      stats: validStats,
      cafes: { listLimitMax: 50 },
      feed: { pageSize: 20 },
      discovery: validCenter,
      seo: validSeo,
      checkins: validCheckins,
      profile: validProfile,
      images: validImages,
      query: validQuery,
      validation: validValidation,
      budgets: validBudgets,
    };
    expect(() =>
      parseAppConfig({ ...base, search: { ...validSearch, goodFirst: undefined } }),
    ).toThrow(/"search\.goodFirst" must be a mapping/);
    expect(() =>
      parseAppConfig({
        ...base,
        search: { ...validSearch, goodFirst: { experienceMin: 80, compositeMin: 75, boost: -1 } },
      }),
    ).toThrow(/"search\.goodFirst\.boost" must be a positive number/);
  });

  it("rejects a missing or mistyped search.responseCache (BRAWUKA-250)", () => {
    const searchWithoutCache = { ...validSearch, responseCache: undefined };
    expect(() =>
      parseAppConfig({
        search: searchWithoutCache,
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: validCheckins,
        profile: validProfile,
        images: validImages,
        query: validQuery,
        validation: validValidation,
        budgets: validBudgets,
      }),
    ).toThrow(/"search\.responseCache" must be a mapping/);
  });

  it("rejects a missing or mistyped search.client (BRAWUKA-250)", () => {
    expect(() =>
      parseAppConfig({
        search: { ...validSearch, client: { minQueryLength: 3, debounceMs: 0 } },
        stats: validStats,
        cafes: { listLimitMax: 50 },
        feed: { pageSize: 20 },
        discovery: validCenter,
        seo: validSeo,
        checkins: validCheckins,
        profile: validProfile,
        images: validImages,
        query: validQuery,
        validation: validValidation,
        budgets: validBudgets,
      }),
    ).toThrow(/"search\.client\.debounceMs" must be a positive integer/);
  });

  it("rejects an inverted or mistyped profile.handle (BRAWUKA-250)", () => {
    const base = {
      search: validSearch,
      stats: validStats,
      cafes: { listLimitMax: 50 },
      feed: { pageSize: 20 },
      discovery: validCenter,
      seo: validSeo,
      checkins: validCheckins,
      images: validImages,
      query: validQuery,
      validation: validValidation,
      budgets: validBudgets,
    };
    expect(() =>
      parseAppConfig({
        ...base,
        profile: {
          ...validProfile,
          handle: { minChars: 31, maxChars: 30, changeCooldownDays: 7, slugMaxChars: 25, generateMaxAttempts: 10 },
        },
      }),
    ).toThrow(/"profile\.handle" "minChars" \(31\) must not exceed "maxChars" \(30\)/);
    expect(() =>
      parseAppConfig({
        ...base,
        profile: { ...validProfile, handle: { ...validProfile.handle, slugMaxChars: 0 } },
      }),
    ).toThrow(/"profile\.handle\.slugMaxChars" must be a positive integer/);
  });

  it("rejects mistyped images/query/validation sections (BRAWUKA-250)", () => {
    const base = {
      search: validSearch,
      stats: validStats,
      cafes: { listLimitMax: 50 },
      feed: { pageSize: 20 },
      discovery: validCenter,
      seo: validSeo,
      checkins: validCheckins,
      profile: validProfile,
      budgets: validBudgets,
    };
    expect(() =>
      parseAppConfig({ ...base, images: { ...validImages, webpQuality: 101 }, query: validQuery, validation: validValidation }),
    ).toThrow(/"images\.webpQuality" must be a number between 1 and 100/);
    expect(() =>
      parseAppConfig({ ...base, images: validImages, query: { ...validQuery, gcTimeMs: -1 }, validation: validValidation }),
    ).toThrow(/"query\.gcTimeMs" must be a positive integer/);
    expect(() =>
      parseAppConfig({ ...base, images: validImages, query: validQuery, validation: { cafeAddressMaxChars: 300 } }),
    ).toThrow(/"validation\.profileCityMaxChars" must be a positive integer/);
  });

});
