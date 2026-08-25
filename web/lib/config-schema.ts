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
  };
  cafes: {
    listLimitMax: number;
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

/** Validate raw parsed YAML into the typed rate-limit table (exported for tests). */
export function parseRateLimits(raw: unknown, file = "rate-limits.yaml"): Record<string, RateLimitBucket> {
  const table = record(file, "(root)", raw);
  const out: Record<string, RateLimitBucket> = {};
  for (const [name, entry] of Object.entries(table)) {
    const bucket = record(file, name, entry);
    out[name] = {
      windowMs: positiveNumber(file, `${name}.windowMs`, bucket.windowMs),
      maxRequests: positiveNumber(file, `${name}.maxRequests`, bucket.maxRequests),
    };
  }
  return out;
}

/** Validate raw parsed YAML into the typed app config (exported for tests). */
export function parseAppConfig(raw: unknown, file = "app.yaml"): AppConfig {
  const root = record(file, "(root)", raw);
  const search = record(file, "search", root.search);
  const cafes = record(file, "cafes", root.cafes);
  const feed = record(file, "feed", root.feed);
  const discovery = record(file, "discovery", root.discovery);
  const defaultCenter = record(file, "discovery.defaultCenter", discovery.defaultCenter);
  const lat = coordinate(file, "discovery.defaultCenter.lat", defaultCenter.lat, 90);
  const lng = coordinate(file, "discovery.defaultCenter.lng", defaultCenter.lng, 180);
  const seo = record(file, "seo", root.seo);
  const shellCache = record(file, "seo.shellCache", seo.shellCache);
  const checkins = record(file, "checkins", root.checkins);
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
    },
    cafes: {
      listLimitMax: positiveNumber(file, "cafes.listLimitMax", cafes.listLimitMax),
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
  };
}

/** Read and parse a YAML config file from web/config (Node contexts only). */
export function loadYaml(file: string): unknown {
  return parse(readFileSync(path.join(process.cwd(), "config", file), "utf8")) as unknown;
}
