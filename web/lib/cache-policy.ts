/**
 * Cafe-shell CDN cache policy (BRAWUKA-184).
 *
 * Single source of truth for the `/cafes/:id*` cache contract. The static
 * `Cache-Control: public, s-maxage=…` header in `next.config.ts` only
 * describes the cacheable case; the bypass fields (owned by
 * `web/config/app.yaml` `seo.shellCache`, DG107) describe every request
 * and response class that MUST NOT sit in shared cache.
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
  /** Statuses that keep the origin TTL (304 revalidation must not no-store). */
  revalidatableStatuses: readonly number[];
  /** Request-cookie name prefixes that force an edge bypass (sb-* sessions). */
  bypassOnRequestCookiePrefixes: readonly string[];
  /** Request-cookie names whose presence forces an edge bypass (`locale`). */
  bypassOnRequestCookies: readonly string[];
  /** Accept-Language substrings that resolve to a non-default locale. */
  bypassOnAcceptLanguageWildcards: readonly string[];
  /** Hosts that bypass edge cache on every route (spec 0005 §3). */
  bypassOnHosts: readonly string[];
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

/** One rule of a Cloudflare `http_request_cache_settings` ruleset. */
interface EdgeCacheRule {
  description: string;
  enabled: boolean;
  expression: string;
  action: "set_cache_settings";
  action_parameters: {
    cache: boolean;
    edge_ttl?: {
      mode: "respect_origin";
      /** No-store ranges covering every status that is neither cacheable
       *  nor revalidatable — the edge-side `onStatusesOtherThan` bypass. */
      status_code_ttl: Array<{
        status_code_range: { from: number; to?: number };
        value: -1;
      }>;
    };
    respect_strong_etags?: boolean;
  };
}

/** The generated artifact: a `http_request_cache_settings` ruleset body
 *  ready for `PUT /zones/{zone}/rulesets/{ruleset}` — the enforceable shape
 *  (BRAWUKA-834). Every entry is a real Cloudflare rule expression; nothing
 *  here is a plan-gated declaration. */
interface CafeShellCdnRules {
  description: string;
  phase: "http_request_cache_settings";
  rules: EdgeCacheRule[];
}

const CACHEABLE_PATH_PREFIX = "/cafes/";

/** No-store status ranges covering everything except the cacheable and
 *  revalidatable statuses. Derivation: walk 200..599, close a range at each
 *  allowed status; 304 must stay exempt or conditional revalidation dies. */
function noStoreStatusCodeTtl(
  cacheableStatuses: readonly number[],
  revalidatableStatuses: readonly number[],
): NonNullable<EdgeCacheRule["action_parameters"]["edge_ttl"]>["status_code_ttl"] {
  const allowed: readonly number[] = [
    ...cacheableStatuses,
    ...revalidatableStatuses,
  ];
  const ranges: Array<{
    status_code_range: { from: number; to?: number };
    value: -1;
  }> = [];
  let from: number | undefined;
  for (let status = 200; status <= 599; status += 1) {
    if (allowed.includes(status)) {
      if (from !== undefined) {
        ranges.push({ status_code_range: { from, to: status - 1 }, value: -1 });
        from = undefined;
      }
    } else if (from === undefined) {
      from = status;
    }
  }
  if (from !== undefined) {
    ranges.push({ status_code_range: { from }, value: -1 });
  }
  return ranges;
}

/**
 * Machine-readable edge ruleset derived from the same policy. Checked into
 * `deploy/dokploy/cache-rules.json` — regenerated and drift-pinned by
 * `npm run gen:cache-rules` / `check:cache-rules` (BRAWUKA-821) — so the
 * deployment flow reads the contract without parsing YAML.
 *
 * BRAWUKA-834: the emitted rules encode the enforced shape — bypass
 * conditions, not custom cache keys. The `cafemood.app` zone is on
 * Cloudflare Free where header/cookie cache keys are Enterprise-only, so a
 * locale-keyed shared entry is impossible: the cacheable rule fires ONLY
 * for a request that cannot resolve to a non-default locale (no `locale`
 * cookie, no zh in Accept-Language, no sb-* session, not a bypass host),
 * and a catch-all bypass covers every other `/cafes/*` request. Shared
 * entries can therefore hold only the default-locale shell. Rule order
 * mirrors the deployed ruleset and is written so the outcome is identical
 * under first-match and last-match semantics (the cacheable expression
 * excludes every bypass condition).
 */
export function cafeShellCdnRules(
  policy: CafeShellCachePolicy,
): CafeShellCdnRules {
  const pathPrefix = `starts_with(http.request.uri.path, "${CACHEABLE_PATH_PREFIX}")`;
  const exclusions = [
    ...policy.bypassOnRequestCookiePrefixes.map(
      (prefix) => `not (http.cookie contains "${prefix}")`,
    ),
    ...policy.bypassOnRequestCookies.map(
      (name) => `not (http.cookie contains "${name}=")`,
    ),
    ...(policy.bypassOnAcceptLanguageWildcards.length > 0
      ? [
          `not (any(http.request.headers["accept-language"][*] wildcard ${policy.bypassOnAcceptLanguageWildcards
            .map((wildcard) => `"${wildcard}"`)
            .join(" or ")}))`,
        ]
      : []),
    ...policy.bypassOnHosts.map((host) => `http.host ne "${host}"`),
  ];
  const cacheableExpression = [pathPrefix, ...exclusions].join(" and ");

  const bypass = (description: string, expression: string): EdgeCacheRule => ({
    description,
    enabled: true,
    expression,
    action: "set_cache_settings",
    action_parameters: { cache: false },
  });

  return {
    description: "Cache settings for cafemood.app",
    phase: "http_request_cache_settings",
    rules: [
      {
        description:
          "Cache the cafe SSR shell only when the request cannot resolve to a non-default locale (deploy/dokploy/cache-rules.json)",
        enabled: true,
        expression: cacheableExpression,
        action: "set_cache_settings",
        action_parameters: {
          cache: true,
          edge_ttl: {
            mode: "respect_origin",
            status_code_ttl: noStoreStatusCodeTtl(
              policy.cacheableStatuses,
              policy.revalidatableStatuses,
            ),
          },
          respect_strong_etags: true,
        },
      },
      ...policy.bypassOnRequestCookiePrefixes.map((prefix) =>
        bypass(
          `Bypass cache on request cookie prefix ${prefix}*`,
          `http.cookie contains "${prefix}"`,
        ),
      ),
      ...policy.bypassOnHosts.map((host) =>
        bypass(
          `Staging/eval host bypasses all routes (spec 0005 §3)`,
          `http.host eq "${host}"`,
        ),
      ),
      bypass(
        "Every other /cafes/* request bypasses the shared cache (locale-negotiated or non-cacheable)",
        pathPrefix,
      ),
    ],
  };
}
