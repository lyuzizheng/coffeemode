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
  /** Request-cookie names whose VALUES join the edge cache key — the
   * `locale` cookie overrides Accept-Language (i18n/request.ts), so it is
   * a cache-key input, not a bypass (BRAWUKA-821). */
  varyCookies: readonly string[];
  /** Exact request-cookie names that MUST bypass shared cache where
   * value-keying is unavailable (Cloudflare custom header/cookie keys are
   * Enterprise-gated; the Free-plan-safe locale remedy, BRAWUKA-834).
   * Deployments supporting varyCookies key the same names instead — the
   * two fields are alternatives, never both. */
  bypassOnRequestCookies: readonly string[];
  /** False = locales MUST NOT share a cache entry. */
  sharedCacheAcrossLocales: boolean;
}

/** Stamped per response by the proxy on session-refresh (Set-Cookie) replies. */
export const CAFE_SHELL_BYPASS_CACHE_CONTROL =
  "private, no-store, must-revalidate";

/** The static cacheable-case header (next.config.ts emits exactly this). */
export function cafeShellCacheControl(policy: CafeShellCachePolicy): string {
  return (
    `public, s-maxage=${policy.sMaxAgeSeconds}, ` +
    `stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`
  );
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
    /** Exact cookie names bypassed where value-keying is unavailable. */
    onRequestCookies: string[];
  };
  varyOn: string[];
  /** Cache-key cookie names (values, not mere presence). */
  varyOnCookies: string[];
  sharedCacheAcrossLocales: boolean;
}

/**
 * Machine-readable edge rule derived from the same policy. Checked into
 * `deploy/dokploy/cache-rules.json` — regenerated and drift-pinned by
 * `npm run gen:cache-rules` / `check:cache-rules` (BRAWUKA-821) — so the
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
      onRequestCookies: [...policy.bypassOnRequestCookies],
    },
    varyOn: [...policy.varyHeaders],
    varyOnCookies: [...policy.varyCookies],
    sharedCacheAcrossLocales: policy.sharedCacheAcrossLocales,
  };
}
