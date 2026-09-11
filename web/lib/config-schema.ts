/**
 * Config schema + parser (DG107), split from `lib/config.ts` so
 * `next.config.ts` can read the typed values without pulling in the
 * `server-only` guard (Next's config transpiler rejects it). Runtime code
 * keeps importing `@/lib/config`, which stays server-only and exports the
 * loaded singletons.
 *
 * Implementations live in `lib/config-schema/` by domain (BRAWUKA-194):
 * `primitives.ts` (shared validators), `rate-limits.ts`
 * (`rate-limits.yaml`), `types.ts` (`AppConfig`), `search.ts` / `seo.ts` /
 * `checkins.ts` / `profile.ts` / `budgets.ts` (per-domain `app.yaml`
 * section parsers), `app.ts` (composition root), `io.ts` (YAML loading).
 * This file is the aggregation barrel so the `@/lib/config-schema`
 * specifier keeps resolving unchanged. No validation semantics live here.
 */

export type { AppConfig } from "./config-schema/types";
export type { RateLimitBucket } from "./config-schema/rate-limits";
export { parseAppConfig } from "./config-schema/app";
export { parseRateLimits } from "./config-schema/rate-limits";
export { loadYaml } from "./config-schema/io";
