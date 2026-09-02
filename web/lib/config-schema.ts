import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/**
 * Config schema + parser (DG107), split from `lib/config.ts` so
 * `next.config.ts` can read the typed values without pulling in the
 * `server-only` guard (Next's config transpiler rejects it). Runtime code
 * keeps importing `@/lib/config`, which stays server-only and exports the
 * loaded singletons.
 */

export interface RateLimitBucket {
  windowMs: number;
  maxRequests: number;
}

export interface AppConfig {
  search: {
    maxRadiusKm: number;
    defaultSuggestionLimit: number;
    maxSuggestionLimit: number;
    weakResultsThreshold: number;
    dbFetchCap: number;
    maxIterativeFetchBatches: number;
    minPoiQueryLength: number;
    relevanceWeights: {
      exactNameMatch: number;
      prefixMatch: number;
      fuzzyMatch: number;
      secondaryMatch: number;
    };
    minRelevanceScore: number;
    externalSources: {
      google: boolean;
      apple: boolean;
    };
    rankingMode: string;
  };
  stats: {
    dimWeights: {
      wifi: number;
      outlets: number;
      seats: number;
      temp: number;
      coffee: number;
    };
    recencyDecay: number;
  };
  cafes: {
    listLimitMax: number;
    serviceAccountId: string;
  };
  feed: {
    pageSize: number;
  };
  discovery: {
    defaultCenter: {
      lat: number;
      lng: number;
    };
  };
  seo: {
    shellCache: {
      sMaxAgeSeconds: number;
      staleWhileRevalidateSeconds: number;
    };
    recoveryLimit: number;
  };
  checkins: {
    photoCap: number;
    noteMaxChars: number;
  };
  profile: {
    listLimitMax: number;
    listPageSize: number;
    displayNameMaxChars: number;
    recentSearchesMax: number;
  };
  budgets: {
    bundle: {
      maxJsChunkBytes: number;
      maxCssChunkBytes: number;
      maxTotalStaticBytes: number;
    };
    lighthouse: {
      performance: number;
      accessibility: number;
      bestPractices: number;
      seo: number;
    };
  };
}

function fail(file: string, keyPath: string, reason: string): never {
  throw new Error(`config ${file}: "${keyPath}" ${reason}`);
}

function positiveNumber(file: string, keyPath: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(file, keyPath, "must be a positive number");
  }
  return value;
}

function positiveInteger(file: string, keyPath: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(file, keyPath, "must be a positive integer");
  }
  return value;
}

/** A number bounded between min and max inclusive. */
function boundedNumber(
  file: string,
  keyPath: string,
  value: unknown,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(file, keyPath, `must be a number between ${min} and ${max}`);
  }
  return value;
}

/** A latitude/longitude number bounded to [-limit, limit]. */
function coordinate(file: string, keyPath: string, value: unknown, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) {
    fail(file, keyPath, `must be a number within [-${limit},${limit}]`);
  }
  return value;
}

function record(file: string, keyPath: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(file, keyPath, "must be a mapping");
  }
  return value as Record<string, unknown>;
}

function parseBucket(file: string, keyPath: string, entry: unknown): RateLimitBucket {
  const bucket = record(file, keyPath, entry);
  return {
    windowMs: positiveNumber(file, `${keyPath}.windowMs`, bucket.windowMs),
    maxRequests: positiveNumber(file, `${keyPath}.maxRequests`, bucket.maxRequests),
  };
}

/** Validate raw parsed YAML into the typed rate-limit table (exported for tests). */
export function parseRateLimits(raw: unknown, file = "rate-limits.yaml"): Record<string, RateLimitBucket | RateLimitBucket[]> {
  const table = record(file, "(root)", raw);
  const out: Record<string, RateLimitBucket | RateLimitBucket[]> = {};
  for (const [name, entry] of Object.entries(table)) {
    if (Array.isArray(entry)) {
      if (entry.length === 0) fail(file, name, "must be a non-empty list of buckets");
      out[name] = entry.map((item, idx) => parseBucket(file, `${name}[${idx}]`, item));
    } else {
      out[name] = parseBucket(file, name, entry);
    }
  }
  return out;
}

/** Validate raw parsed YAML into the typed app config (exported for tests). */
export function parseAppConfig(raw: unknown, file = "app.yaml"): AppConfig {
  const root = record(file, "(root)", raw);
  const search = record(file, "search", root.search);
  const relevanceWeights = record(file, "search.relevanceWeights", search.relevanceWeights);
  const stats = record(file, "stats", root.stats);
  const dimWeights = record(file, "stats.dimWeights", stats.dimWeights);
  const cafes = record(file, "cafes", root.cafes);
  const feed = record(file, "feed", root.feed);
  const discovery = record(file, "discovery", root.discovery);
  const defaultCenter = record(file, "discovery.defaultCenter", discovery.defaultCenter);
  const lat = coordinate(file, "discovery.defaultCenter.lat", defaultCenter.lat, 90);
  const lng = coordinate(file, "discovery.defaultCenter.lng", defaultCenter.lng, 180);
  const seo = record(file, "seo", root.seo);
  const shellCache = record(file, "seo.shellCache", seo.shellCache);
  const checkins = record(file, "checkins", root.checkins);
  const profile = record(file, "profile", root.profile);
  const budgets = record(file, "budgets", root.budgets);
  const bundle = record(file, "budgets.bundle", budgets.bundle);
  const lighthouse = record(file, "budgets.lighthouse", budgets.lighthouse);
  return {
    search: {
      maxRadiusKm: positiveNumber(file, "search.maxRadiusKm", search.maxRadiusKm),
      defaultSuggestionLimit: positiveInteger(
        file,
        "search.defaultSuggestionLimit",
        search.defaultSuggestionLimit,
      ),
      maxSuggestionLimit: positiveInteger(
        file,
        "search.maxSuggestionLimit",
        search.maxSuggestionLimit,
      ),
      weakResultsThreshold: positiveInteger(
        file,
        "search.weakResultsThreshold",
        search.weakResultsThreshold,
      ),
      dbFetchCap: positiveInteger(file, "search.dbFetchCap", search.dbFetchCap),
      maxIterativeFetchBatches: positiveInteger(
        file,
        "search.maxIterativeFetchBatches",
        search.maxIterativeFetchBatches,
      ),
      minPoiQueryLength: positiveInteger(
        file,
        "search.minPoiQueryLength",
        search.minPoiQueryLength,
      ),
      relevanceWeights: {
        exactNameMatch: positiveNumber(
          file,
          "search.relevanceWeights.exactNameMatch",
          relevanceWeights.exactNameMatch,
        ),
        prefixMatch: positiveNumber(
          file,
          "search.relevanceWeights.prefixMatch",
          relevanceWeights.prefixMatch,
        ),
        fuzzyMatch: positiveNumber(
          file,
          "search.relevanceWeights.fuzzyMatch",
          relevanceWeights.fuzzyMatch,
        ),
        secondaryMatch: positiveNumber(
          file,
          "search.relevanceWeights.secondaryMatch",
          relevanceWeights.secondaryMatch,
        ),
      },
      minRelevanceScore:
        search.minRelevanceScore === undefined
          ? 50
          : positiveInteger(file, "search.minRelevanceScore", search.minRelevanceScore),
      externalSources: (() => {
        if (search.externalSources === undefined) return { google: true, apple: false };
        const es = record(file, "search.externalSources", search.externalSources);
        if (typeof es.google !== "boolean" || typeof es.apple !== "boolean") {
          fail(file, "search.externalSources", "must be {google:boolean, apple:boolean}");
        }
        return { google: es.google, apple: es.apple };
      })(),
      rankingMode: (() => {
        if (search.rankingMode === undefined) return "relevance";
        const v = search.rankingMode;
        if (v !== "relevance" && v !== "good_first") {
          fail(file, "search.rankingMode", "must be \"relevance\" or \"good_first\"");
        }
        return v as string;
      })(),
    },
    stats: {
      dimWeights: {
        wifi: positiveNumber(file, "stats.dimWeights.wifi", dimWeights.wifi),
        outlets: positiveNumber(file, "stats.dimWeights.outlets", dimWeights.outlets),
        seats: positiveNumber(file, "stats.dimWeights.seats", dimWeights.seats),
        temp: positiveNumber(file, "stats.dimWeights.temp", dimWeights.temp),
        coffee: positiveNumber(file, "stats.dimWeights.coffee", dimWeights.coffee),
      },
      recencyDecay: positiveNumber(file, "stats.recencyDecay", stats.recencyDecay),
    },
    cafes: {
      listLimitMax: positiveNumber(file, "cafes.listLimitMax", cafes.listLimitMax),
      serviceAccountId: (() => {
        const id = cafes.serviceAccountId;
        if (typeof id !== "string" || id.trim() === "") {
          fail(file, "cafes.serviceAccountId", "must be a non-empty string UUID");
        }
        return id.trim();
      })(),
    },
    feed: {
      pageSize: positiveNumber(file, "feed.pageSize", feed.pageSize),
    },
    discovery: {
      defaultCenter: { lat, lng },
    },
    seo: {
      shellCache: {
        sMaxAgeSeconds: positiveInteger(
          file,
          "seo.shellCache.sMaxAgeSeconds",
          shellCache.sMaxAgeSeconds,
        ),
        staleWhileRevalidateSeconds: positiveInteger(
          file,
          "seo.shellCache.staleWhileRevalidateSeconds",
          shellCache.staleWhileRevalidateSeconds,
        ),
      },
      recoveryLimit: positiveInteger(file, "seo.recoveryLimit", seo.recoveryLimit),
    },
    checkins: {
      photoCap: positiveInteger(file, "checkins.photoCap", checkins.photoCap),
      noteMaxChars: positiveInteger(file, "checkins.noteMaxChars", checkins.noteMaxChars),
    },
    profile: {
      listLimitMax: positiveInteger(file, "profile.listLimitMax", profile.listLimitMax),
      listPageSize: positiveInteger(file, "profile.listPageSize", profile.listPageSize),
      displayNameMaxChars: positiveInteger(
        file,
        "profile.displayNameMaxChars",
        profile.displayNameMaxChars,
      ),
      recentSearchesMax: positiveInteger(
        file,
        "profile.recentSearchesMax",
        profile.recentSearchesMax,
      ),
    },
    budgets: {
      bundle: {
        maxJsChunkBytes: positiveInteger(
          file,
          "budgets.bundle.maxJsChunkBytes",
          bundle.maxJsChunkBytes,
        ),
        maxCssChunkBytes: positiveInteger(
          file,
          "budgets.bundle.maxCssChunkBytes",
          bundle.maxCssChunkBytes,
        ),
        maxTotalStaticBytes: positiveInteger(
          file,
          "budgets.bundle.maxTotalStaticBytes",
          bundle.maxTotalStaticBytes,
        ),
      },
      lighthouse: {
        performance: boundedNumber(
          file,
          "budgets.lighthouse.performance",
          lighthouse.performance,
          0,
          1,
        ),
        accessibility: boundedNumber(
          file,
          "budgets.lighthouse.accessibility",
          lighthouse.accessibility,
          0,
          1,
        ),
        bestPractices: boundedNumber(
          file,
          "budgets.lighthouse.bestPractices",
          lighthouse.bestPractices,
          0,
          1,
        ),
        seo: boundedNumber(file, "budgets.lighthouse.seo", lighthouse.seo, 0, 1),
      },
    },
  };
}

/** Read and parse a YAML config file from web/config (Node contexts only). */
export function loadYaml(file: string): unknown {
  return parse(readFileSync(path.join(process.cwd(), "config", file), "utf8")) as unknown;
}
