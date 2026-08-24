import "server-only";

import { loadYaml, parseAppConfig, parseRateLimits } from "./config-schema";
import type { RateLimitBucket } from "./config-schema";

/**
 * Universal typed config (DG107). Product parameters live in
 * `web/config/*.yaml`; code reads them through these helpers — never
 * hardcoded. The files are loaded once at module init and validated against
 * the schema in `lib/config-schema.ts`: a missing key or wrong type throws
 * at startup with the offending path, so a bad config can never serve
 * traffic.
 *
 * The schema/parser lives in `config-schema.ts` (no `server-only` guard) so
 * `next.config.ts` can read the same typed values; runtime code imports
 * this module.
 *
 * Cross-service constants shared with the Cloudflare Workers (upload byte
 * cap, worker bounding-box ceiling) stay in `web/shared/` — the workers
 * cannot read these files.
 */

export type { AppConfig, RateLimitBucket } from "./config-schema";
export { parseAppConfig, parseRateLimits } from "./config-schema";

/** All rate limits (DG74), keyed by bucket name. */
export const rateLimits: Readonly<Record<string, RateLimitBucket>> = Object.freeze(
  parseRateLimits(loadYaml("rate-limits.yaml")),
);

/** Everything else (DG107). */
export const appConfig = Object.freeze(parseAppConfig(loadYaml("app.yaml")));

/** Look up a rate-limit bucket by name; unknown names throw at the call site. */
export function rateLimitConfig(name: string): RateLimitBucket {
  const bucket = rateLimits[name];
  if (!bucket) {
    throw new Error(`config rate-limits.yaml: unknown rate limit "${name}"`);
  }
  return bucket;
}
