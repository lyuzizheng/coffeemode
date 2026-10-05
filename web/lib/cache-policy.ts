/**
 * Cafe-shell CDN cache policy (BRAWUKA-184).
 *
 * Single source of truth for the `/cafes/:id*` cache contract. The static
 * `Cache-Control: public, s-maxage=…` header in `next.config.ts` only
 * describes the cacheable case; the bypass fields (owned by
 * `web/config/app.yaml` `seo.shellCache`, DG107) describe every request or
 * response that MUST NOT sit in shared cache.
 *
 * Locale safety is enforced as a bypass contract, not a cache key: the
 * origin negotiates locale from `locale` cookie → Accept-Language → en
 * (i18n/request.ts) but ships no usable Vary on App Router HTML, and
 * custom header/cookie cache keys are not part of the deployed edge
 * plan's toolbox (BRAWUKA-834 readback). The only locale-safe shared
 * cache is therefore the request that PROVES the default locale — any
 * request carrying a non-default-locale signal bypasses (BRAWUKA-821).
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
  /** Exact request-cookie names that force an edge bypass (`locale`). */
  bypassOnRequestCookies: readonly string[];
  /** Accept-Language substrings that resolve to a non-default locale. */
  bypassOnAcceptLanguageContains: readonly string[];
  /** Request Host values that bypass all caching (staging — spec 0005 §3). */
  bypassHostnames: readonly string[];
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
    /** Exact cookie names bypassed (any `locale` cookie — presence). */
    onRequestCookies: string[];
    /** Accept-Language substrings bypassed (non-default locales). */
    onAcceptLanguageContains: string[];
    /** Request Host values bypassed (staging — spec 0005 §3). */
    onHostnames: string[];
  };
  sharedCacheAcrossLocales: boolean;
}

/**
 * Machine-readable edge rule derived from the same policy. Checked into
 * `deploy/dokploy/cache-rules.json` — regenerated and drift-pinned by
 * `npm run gen:cache-rules` / `check:cache-rules` (BRAWUKA-821) — so the
 * deployment flow reads the contract without parsing YAML. The matching
 * deployable payload is `deploy/dokploy/cloudflare-cache-rules.json`,
 * rendered by `cafeShellCloudflareRuleset()` below.
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
      onAcceptLanguageContains: [...policy.bypassOnAcceptLanguageContains],
      onHostnames: [...policy.bypassHostnames],
    },
    sharedCacheAcrossLocales: policy.sharedCacheAcrossLocales,
  };
}

/* ------------------------------------------------------------------ *
 * Deployable Cloudflare ruleset (BRAWUKA-821/834/836).
 *
 * The policy's bypass signals compile into `http_request_cache_settings`
 * rules evaluated top-down; the LAST matching `set_cache_settings` wins
 * (https://developers.cloudflare.com/cache/how-to/cache-rules/order/):
 *
 *   1. ALLOW  /cafes/* that cannot resolve to a non-default locale →
 *      cache, respect_origin TTL, no-store outside cacheableStatuses.
 *   2. BYPASS auth-cookie requests (sb-* prefixes), zone-wide.
 *   3. BYPASS the staging host entirely (spec 0005 §3).
 *   4. FALLBACK  /cafes/* carrying any non-default-locale signal →
 *      bypass. This is the algebraic complement of the allow rule's
 *      request conditions: the same signal list, rendered positive.
 *      Emitting the complement — never a bare `/cafes/` catch-all — is
 *      what keeps rule 1 reachable for default-locale requests
 *      (BRAWUKA-836; the hand-edited v7 payload matched every /cafes/*
 *      request here and silently disabled the allow rule).
 *
 * The signal list is authored once (the policy); expression strings and
 * the evaluator below derive from it, so the compiled payload and the
 * test oracle cannot diverge.
 * ------------------------------------------------------------------ */

interface CacheSignal {
  readonly kind: "cookiePrefix" | "cookieExact" | "acceptLanguage" | "hostname";
  readonly value: string;
}

function cafeShellSignals(policy: CafeShellCachePolicy): CacheSignal[] {
  return [
    ...policy.bypassOnRequestCookiePrefixes.map(
      (value): CacheSignal => ({ kind: "cookiePrefix", value }),
    ),
    ...policy.bypassOnRequestCookies.map(
      (value): CacheSignal => ({ kind: "cookieExact", value }),
    ),
    ...policy.bypassOnAcceptLanguageContains.map(
      (value): CacheSignal => ({ kind: "acceptLanguage", value }),
    ),
    ...policy.bypassHostnames.map(
      (value): CacheSignal => ({ kind: "hostname", value }),
    ),
  ];
}

/** Positive Cloudflare filter term for one bypass signal. */
function signalTerm(signal: CacheSignal): string {
  switch (signal.kind) {
    case "cookiePrefix":
      return `http.cookie contains "${signal.value}"`;
    case "cookieExact":
      return `http.cookie contains "${signal.value}="`;
    case "acceptLanguage":
      return `any(http.request.headers["accept-language"][*] wildcard "*${signal.value}*")`;
    case "hostname":
      return `http.host eq "${signal.value}"`;
  }
}

/** Negated term inside the allow rule (hostname renders `ne` like the
 *  hand-verified v7 payload). */
function negatedTerm(signal: CacheSignal): string {
  return signal.kind === "hostname"
    ? `http.host ne "${signal.value}"`
    : `not (${signalTerm(signal)})`;
}

const CAFE_PATH_PREFIX = `starts_with(http.request.uri.path, "/cafes/")`;
const NEVER_MATCHES = `not (starts_with(http.request.uri.path, "/"))`;

/** Non-cacheable status ranges for `status_code_ttl` (value -1 = no-store).
 *  Complement of `cacheableStatuses` over [200, ∞); 304 is excluded — it is
 *  a revalidation response, not a stored document. */
function nonCacheableRanges(cacheableStatuses: readonly number[]) {
  const blocked = new Set<number>([...cacheableStatuses, 304]);
  const ranges: { from: number; to?: number }[] = [];
  let cursor = 200;
  for (let status = 200; status <= 599; status += 1) {
    if (!blocked.has(status)) continue;
    if (status > cursor) ranges.push({ from: cursor, to: status - 1 });
    cursor = status + 1;
  }
  ranges.push({ from: Math.max(cursor, 200) });
  return ranges.filter((r) => r.to === undefined || r.from <= r.to);
}

interface CloudflareRule {
  description: string;
  enabled: boolean;
  expression: string;
  action: string;
  action_parameters: Record<string, unknown>;
}

export interface CloudflareCacheRuleset {
  request: {
    phase: "http_request_cache_settings";
    description: string;
    rules: CloudflareRule[];
  };
  response: {
    phase: "http_response_cache_settings";
    description: string;
    rules: CloudflareRule[];
  };
}

/** The deployable edge ruleset compiled from the same policy.
 *
 * Request-phase order mirrors the deployed v9 ruleset — deny-first,
 * allow-last, the safe direction under Cloudflare's last-match-wins:
 *   1. BYPASS catch-all — every /cafes/* request denies cache unless a
 *      later rule overrides (an early catch-all CANNOT disable the allow
 *      rule; putting it last did — BRAWUKA-836).
 *   2. BYPASS  any request with an sb-* auth cookie (zone-wide).
 *   3. BYPASS  the staging host, all routes (spec 0005 §3).
 *   4. ALLOW   /cafes/* provably default-locale → cache + TTL policy —
 *      LAST, so it overrides the catch-all only where every exclusion
 *      holds.
 *
 * Response phase (contract bypass.onResponseSetCookie): a /cafes/*
 * response that sets a cookie is pinned no-store — the request-side
 * sb- bypass is only a proxy for a response-side property.
 *
 * Expressions stay `and`/`not`-only so the repo's rules-language
 * evaluator (scripts/devops/lib/rules-language.mjs) can prove
 * per-request outcomes offline.
 */
export function cafeShellCloudflareRuleset(
  policy: CafeShellCachePolicy,
): CloudflareCacheRuleset {
  const signals = cafeShellSignals(policy);
  const allowExpr = [CAFE_PATH_PREFIX, ...signals.map(negatedTerm)].join(" and ");
  const bypass = (description: string, expression: string): CloudflareRule => ({
    description,
    enabled: true,
    expression,
    action: "set_cache_settings",
    action_parameters: { cache: false },
  });
  return {
    request: {
      phase: "http_request_cache_settings",
      description: "Cache settings for cafemood.app",
      rules: [
        bypass(
          "BRAWUKA-834: every /cafes/* request bypasses the shared cache unless the cache-eligible rule below proves it resolves to the default locale",
          CAFE_PATH_PREFIX,
        ),
        ...policy.bypassOnRequestCookiePrefixes.map((v) =>
          bypass(
            "Bypass cache on auth cookies",
            `http.cookie contains "${v}"`,
          ),
        ),
        ...policy.bypassHostnames.map((v) =>
          bypass(
            "BRAWUKA-834: staging bypasses all routes (spec 0005 §3)",
            `http.host eq "${v}"`,
          ),
        ),
        {
          description:
            "BRAWUKA-834: cache the cafe SSR shell only when the request cannot resolve to a non-default locale (deploy/dokploy/cache-rules.json)",
          enabled: true,
          expression: allowExpr,
          action: "set_cache_settings",
          action_parameters: {
            cache: true,
            edge_ttl: {
              mode: "respect_origin",
              status_code_ttl: nonCacheableRanges(
                policy.cacheableStatuses,
              ).map(({ from, to }) => ({
                status_code_range: to === undefined ? { from } : { from, to },
                value: -1,
              })),
            },
            respect_strong_etags: true,
          },
        },
      ],
    },
    response: {
      phase: "http_response_cache_settings",
      description: "Cache settings for cafemood.app",
      rules: policy.bypassOnSetCookieResponse
        ? [
            {
              description:
                "BRAWUKA-834: a /cafes/* response that sets a cookie is never stored in the shared cache (deploy/dokploy/cache-rules.json bypass.onResponseSetCookie)",
              enabled: true,
              expression: `${CAFE_PATH_PREFIX} and any(http.response.headers["set-cookie"][*] ne "")`,
              action: "set_cache_control",
              action_parameters: {
                "no-store": { cloudflare_only: true, operation: "set" },
              },
            },
          ]
        : [],
    },
  };
}

/* ------------------------------------------------------------------ *
 * Policy-level outcome model — the test oracle for the ruleset above.
 * Evaluates the same signal list with the same last-match-wins order, so
 * the drift test can prove per-request outcomes (cache / bypass /
 * uncached) without a Cloudflare expression engine.
 * ------------------------------------------------------------------ */

export interface CacheableRequest {
  path: string;
  host: string;
  /** Raw Cookie header value (empty string = no cookies). */
  cookie: string;
  /** Accept-Language header value. */
  acceptLanguage: string;
}

function signalMatches(signal: CacheSignal, req: CacheableRequest): boolean {
  switch (signal.kind) {
    case "cookiePrefix":
      return req.cookie.includes(signal.value);
    case "cookieExact":
      return req.cookie.includes(`${signal.value}=`);
    case "acceptLanguage":
      return req.acceptLanguage.toLowerCase().includes(signal.value.toLowerCase());
    case "hostname":
      return req.host === signal.value;
  }
}

/** Effective outcome for one request, last-match-wins over the four rules. */
export function cafeShellCacheOutcome(
  policy: CafeShellCachePolicy,
  req: CacheableRequest,
): "cache" | "bypass" | "uncached" {
  const signals = cafeShellSignals(policy);
  const isCafe = req.path.startsWith("/cafes/");
  const hasSignal = signals.some((s) => signalMatches(s, req));
  const hasAuthCookie = policy.bypassOnRequestCookiePrefixes.some((p) =>
    req.cookie.includes(p),
  );
  const isBypassHost = policy.bypassHostnames.includes(req.host);
  // Rule order 1→4, last matching set_cache_settings wins.
  let outcome: "cache" | "bypass" | "uncached" = "uncached";
  if (isCafe && !hasSignal) outcome = "cache";
  if (hasAuthCookie) outcome = "bypass";
  if (isBypassHost) outcome = "bypass";
  if (isCafe && hasSignal) outcome = "bypass";
  return outcome;
}
