import { fail, positiveNumber, record } from "./primitives";

/** One rate-limit window: at most maxRequests per windowMs. */
export interface RateLimitBucket {
  windowMs: number;
  maxRequests: number;
}

function parseBucket(file: string, keyPath: string, entry: unknown): RateLimitBucket {
  const bucket = record(file, keyPath, entry);
  return {
    windowMs: positiveNumber(file, `${keyPath}.windowMs`, bucket.windowMs),
    maxRequests: positiveNumber(file, `${keyPath}.maxRequests`, bucket.maxRequests),
  };
}

/** Validate raw parsed YAML into the typed rate-limit table (exported for tests). */
export function parseRateLimits(
  raw: unknown,
  file = "rate-limits.yaml",
): Record<string, RateLimitBucket | RateLimitBucket[]> {
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
