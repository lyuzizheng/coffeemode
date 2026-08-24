import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/**
 * Universal typed config (DG107). Product parameters live in
 * `web/config/*.yaml`; code reads them through these helpers — never
 * hardcoded. The files are loaded once at module init and validated against
 * the schema below: a missing key or wrong type throws at startup with the
 * offending path, so a bad config can never serve traffic.
 *
 * Cross-service constants shared with the Cloudflare Workers (upload byte
 * cap, worker bounding-box ceiling) stay in `web/shared/` — the workers
 * cannot read these files.
 */

export interface RateLimitBucket {
  windowMs: number;
  maxRequests: number;
}

export interface AppConfig {
  search: {
    maxRadiusKm: number;
  };
  cafes: {
    listLimitMax: number;
  };
  feed: {
    pageSize: number;
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
  return {
    search: {
      maxRadiusKm: positiveNumber(file, "search.maxRadiusKm", search.maxRadiusKm),
    },
    cafes: {
      listLimitMax: positiveNumber(file, "cafes.listLimitMax", cafes.listLimitMax),
    },
    feed: {
      pageSize: positiveNumber(file, "feed.pageSize", feed.pageSize),
    },
  };
}

function loadYaml(file: string): unknown {
  return parse(readFileSync(path.join(process.cwd(), "config", file), "utf8")) as unknown;
}

/** All rate limits (DG74), keyed by bucket name. */
export const rateLimits: Readonly<Record<string, RateLimitBucket>> = Object.freeze(
  parseRateLimits(loadYaml("rate-limits.yaml")),
);

/** Everything else (DG107). */
export const appConfig: Readonly<AppConfig> = Object.freeze(parseAppConfig(loadYaml("app.yaml")));

/** Look up a rate-limit bucket by name; unknown names throw at the call site. */
export function rateLimitConfig(name: string): RateLimitBucket {
  const bucket = rateLimits[name];
  if (!bucket) {
    throw new Error(`config rate-limits.yaml: unknown rate limit "${name}"`);
  }
  return bucket;
}
