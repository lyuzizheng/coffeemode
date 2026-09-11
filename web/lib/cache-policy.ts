/**
 * Cafe-shell CDN cache policy (BRAWUKA-184).
 *
 * Single source of truth for the `/cafes/:id*` cache contract. The static
 * `Cache-Control: public, s-maxage=…` header in `next.config.ts` only
 * describes the cacheable case; the bypass fields (owned by
 * `web/config/app.yaml` `seo.shellCache`, DG107) describe every response
 * that MUST NOT sit in shared cache.
 *
 * Edge-safe by construction: no `node:` imports, no `server-only` guard, so
 * `proxy.ts` (edge runtime), `next.config.ts` (config transpiler), unit
 * tests, and the deploy export can all import this module.
 */

interface CafeShellCachePolicy {
  sMaxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
  /** Only these statuses may sit in shared cache (gone-cafe 404s must not). */
  cacheableStatuses: readonly number[];
  /** A response carrying Set-Cookie (session refresh) must bypass. */
  bypassOnSetCookieResponse: boolean;
  /** Request-cookie name prefixes that force an edge bypass (sb-* sessions). */
  bypassOnRequestCookiePrefixes: readonly string[];
  /** Edge cache-key headers (origin Vary is stripped by Next on HTML). */
  varyHeaders: readonly string[];
  /** False = locales MUST NOT share a cache entry. */
  sharedCacheAcrossLocales: boolean;
}

/** Stamped per response by the proxy whenever {@link shouldBypass} holds. */
export const CAFE_SHELL_BYPASS_CACHE_CONTROL =
  "private, no-store, must-revalidate";

/** The static cacheable-case header (next.config.ts emits exactly this). */
export function cafeShellCacheControl(policy: CafeShellCachePolicy): string {
  return (
    `public, s-maxage=${policy.sMaxAgeSeconds}, ` +
    `stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`
  );
}

interface CafeShellResponseSignal {
  /** Final response status (404 for the gone-cafe surface). */
  status: number;
  /** True when the response carries Set-Cookie (session refresh). */
  setCookiePresent: boolean;
}

/**
 * Per-response bypass decision. True = MUST NOT be shared-cached: the proxy
 * stamps {@link CAFE_SHELL_BYPASS_CACHE_CONTROL} and the edge rule bypasses.
 */
export function shouldBypassCafeShellCache(
  policy: CafeShellCachePolicy,
  signal: CafeShellResponseSignal,
): boolean {
  if (!policy.cacheableStatuses.includes(signal.status)) return true;
  if (policy.bypassOnSetCookieResponse && signal.setCookiePresent) return true;
  return false;
}

interface CafeShellCdnRules {
  scope: { paths: string[] };
  cacheable: {
    statuses: number[];
    cacheControl: string;
    staleWhileRevalidateSeconds: number;
  };
  bypass: {
    onResponseSetCookie: boolean;
    onStatusesOtherThan: number[];
    onRequestCookiePrefixes: string[];
  };
  varyOn: string[];
  sharedCacheAcrossLocales: boolean;
}

/**
 * Machine-readable edge rule derived from the same policy. Checked into
 * `deploy/dokploy/cache-rules.json` (drift-pinned by unit test) so the
 * deployment flow reads the contract without parsing YAML.
 */
export function cafeShellCdnRules(
  policy: CafeShellCachePolicy,
): CafeShellCdnRules {
  return {
    scope: { paths: ["/cafes/*"] },
    cacheable: {
      statuses: [...policy.cacheableStatuses],
      cacheControl: cafeShellCacheControl(policy),
      staleWhileRevalidateSeconds: policy.staleWhileRevalidateSeconds,
    },
    bypass: {
      onResponseSetCookie: policy.bypassOnSetCookieResponse,
      onStatusesOtherThan: [...policy.cacheableStatuses],
      onRequestCookiePrefixes: [...policy.bypassOnRequestCookiePrefixes],
    },
    varyOn: [...policy.varyHeaders],
    sharedCacheAcrossLocales: policy.sharedCacheAcrossLocales,
  };
}
