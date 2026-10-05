/**
 * Cache-policy validation — the checks behind `check-cache-policy.mjs`
 * (BRAWUKA-834/836/837/839). Split out so the CLI driver stays a thin
 * arg/print shell: everything in this module is pure
 * (contract, payload) -> failures/outcomes, no I/O.
 *
 * Four checks, run in `checkCachePolicy()`:
 *
 *   shape      the payload declares the phases the applier PUTs (BRAWUKA-837)
 *   coverage   every ACTIVE cache-eligible rule implements the whole
 *              contract — per-rule, not the first match (r3 P1)
 *   outcomes   representative requests evaluated last-match-wins through
 *              the same rules-language engine the edge runs
 *   response   the Set-Cookie no-store rule exists and behaves
 *
 * The contract has no custom cache keys (unavailable on this zone's plan),
 * so its signals live under `bypass.*` — the payload must implement every
 * declared bypass; extra strictness is fine.
 */

import { evaluateResponseRules, evaluateRules } from "./rules-language.mjs";

// ---------------------------------------------------------------------------
// Representative requests (BRAWUKA-836 acceptance: effective outcomes)
// ---------------------------------------------------------------------------

const PROBE_PATH = "/cafes/review-probe";

const CASES = [
  {
    name: "production, default locale (no cookie, Accept-Language en)",
    request: { host: "cafemood.app", path: PROBE_PATH, cookie: "", acceptLanguage: ["en"] },
    cache: true,
  },
  {
    name: "production, Accept-Language en-US",
    request: {
      host: "cafemood.app",
      path: PROBE_PATH,
      cookie: "",
      acceptLanguage: ["en-US,en;q=0.9"],
    },
    cache: true,
  },
  {
    name: "production, Accept-Language zh-CN",
    request: { host: "cafemood.app", path: PROBE_PATH, cookie: "", acceptLanguage: ["zh-CN"] },
    cache: false,
  },
  {
    name: "production, Accept-Language zh-TW (same zh family)",
    request: { host: "cafemood.app", path: PROBE_PATH, cookie: "", acceptLanguage: ["zh-TW"] },
    cache: false,
  },
  {
    name: "production, Accept-Language zh-HK",
    request: { host: "cafemood.app", path: PROBE_PATH, cookie: "", acceptLanguage: ["zh-HK,zh;q=0.9"] },
    cache: false,
  },
  {
    name: "production, locale=zh cookie",
    request: {
      host: "cafemood.app",
      path: PROBE_PATH,
      cookie: "locale=zh",
      acceptLanguage: ["en"],
    },
    cache: false,
  },
  {
    name: "production, session cookie",
    request: {
      host: "cafemood.app",
      path: PROBE_PATH,
      cookie: "sb-abcdef-auth-token=1",
      acceptLanguage: ["en"],
    },
    cache: false,
  },
  {
    name: "staging (spec 0005 §3 bypasses every route)",
    request: {
      host: "staging.cafemood.app",
      path: PROBE_PATH,
      cookie: "",
      acceptLanguage: ["en"],
    },
    cache: false,
  },
  {
    name: "outside the cafe-shell scope",
    request: { host: "cafemood.app", path: "/search", cookie: "", acceptLanguage: ["en"] },
    cache: null,
  },
];

export function checkOutcomes(payload) {
  const failures = [];
  const outcomes = [];
  const rules = Array.isArray(payload.request?.rules) ? payload.request.rules : [];
  for (const testCase of CASES) {
    const { matched, setting } = evaluateRules(rules, testCase.request);
    outcomes.push({ name: testCase.name, expected: testCase.cache, actual: setting, matched });
    if (setting !== testCase.cache) {
      failures.push(
        `${testCase.name}: expected cache=${testCase.cache}, got ${setting} ` +
          `(matched: ${matched.join(" | ") || "no rule"})`,
      );
    }
  }
  return { failures, outcomes };
}

// ---------------------------------------------------------------------------
// Response phase (contract bypass.onResponseSetCookie)
// ---------------------------------------------------------------------------

const RESPONSE_CASES = [
  {
    name: "response sets a cookie",
    request: { host: "cafemood.app", path: PROBE_PATH, setCookie: ["sb-refresh=1; Path=/"] },
    noStore: true,
  },
  {
    name: "response sets no cookie",
    request: { host: "cafemood.app", path: PROBE_PATH, setCookie: [] },
    noStore: false,
  },
  {
    name: "response outside the cafe-shell scope sets a cookie",
    request: { host: "cafemood.app", path: "/search", setCookie: ["a=1"] },
    noStore: false,
  },
];

export function checkResponseOutcomes(payload) {
  const failures = [];
  const outcomes = [];
  const rules = Array.isArray(payload.response?.rules) ? payload.response.rules : [];
  for (const testCase of RESPONSE_CASES) {
    const { matched, parameters } = evaluateResponseRules(rules, testCase.request);
    const actual = parameters?.["no-store"]?.operation === "set";
    outcomes.push({ name: testCase.name, expected: testCase.noStore, actual, matched });
    if (actual !== testCase.noStore) {
      failures.push(
        `${testCase.name}: expected no_store=${testCase.noStore}, got ${actual} ` +
          `(matched: ${matched.join(" | ") || "no rule"})`,
      );
    }
  }
  return { failures, outcomes };
}

// ---------------------------------------------------------------------------
// Contract coverage: the payload must implement every declared requirement
// ---------------------------------------------------------------------------

function statusCovered(entry, status) {
  if (entry.status_code !== undefined) return entry.status_code === status;
  const range = entry.status_code_range ?? {};
  return status >= (range.from ?? 200) && status <= (range.to ?? 599);
}

/**
 * Every ACTIVE cache-eligible rule must implement the whole contract —
 * Cloudflare lets any `cache: true` rule override earlier bypasses under
 * last-match-wins, so validating only the first allow rule admits a later
 * `Accept-Language: zh-TW` cache rule that the declared policy forbids
 * (r3 P1). Disabled rules are skipped the way the edge skips them; a
 * `enabled: false` bypass is not protection.
 */
export function checkCoverage(contract, payload) {
  const failures = [];
  const rules = payload.request?.rules ?? [];
  const active = rules.filter((rule) => rule.enabled !== false);
  const allows = active.filter((rule) => rule.action_parameters?.cache === true);
  const bypasses = active.filter((rule) => rule.action_parameters?.cache === false);

  if (allows.length === 0) {
    failures.push("payload has no cache-eligible rule");
    return failures;
  }

  const localeCookies = contract.bypass?.onRequestCookies ?? [];
  const languageSignals = contract.bypass?.onAcceptLanguageContains ?? [];
  const catchAll = 'starts_with(http.request.uri.path, "/cafes/")';

  for (const allow of allows) {
    const tag = `cache-eligible rule "${allow.description || allow.expression.slice(0, 60)}"`;

    for (const scopePath of contract.scope?.paths ?? []) {
      const prefix = scopePath.replace(/\*+$/, "");
      if (!allow.expression.includes(`"${prefix}"`)) {
        failures.push(`${tag} does not scope ${scopePath}`);
      }
    }

    const cacheableContract = contract.cacheable ?? {};
    const cacheable = new Set(cacheableContract.statuses ?? []);
    const noStore = (allow.action_parameters.edge_ttl?.status_code_ttl ?? []).filter(
      (entry) => entry.value === -1,
    );
    for (let status = 200; status <= 599; status += 1) {
      if (cacheable.has(status)) continue;
      // 304 is exempt on purpose: Cloudflare inherits the 200 TTL for 304 when
      // no explicit TTL is set, and an explicit no-store on 304 makes every
      // subsequent request revalidate (developers.cloudflare.com/cache/how-to/
      // configure-cache-status-code/). A 304 carries no body, so it cannot
      // store a stale shell.
      if (status === 304) continue;
      if (!noStore.some((entry) => statusCovered(entry, status))) {
        failures.push(`status ${status} is not pinned no-store on the ${tag}`);
      }
    }

    // TTL semantics: respect_origin is what makes the contract's s-maxage /
    // stale-while-revalidate meaningful — an override would silently ignore
    // the origin TTL (BRAWUKA-836). strong ETags are required for SWR
    // revalidation.
    if (cacheable.size > 0) {
      const edgeTtl = allow.action_parameters?.edge_ttl;
      if (!edgeTtl || edgeTtl.mode !== "respect_origin") {
        failures.push(`${tag} must keep edge_ttl.mode=respect_origin`);
      }
      if (
        (cacheableContract.staleWhileRevalidateSeconds ?? 0) > 0 &&
        allow.action_parameters?.respect_strong_etags !== true
      ) {
        failures.push(`${tag} needs respect_strong_etags for stale-while-revalidate`);
      }
    }

    // Locale signal exclusions must hold on EVERY allow rule — a later
    // allow that drops them caches non-default-locale requests the bypass
    // contract forbids. Require the negated term: a positive
    // `contains "locale="` in an allow expression is not an exclusion.
    for (const cookie of localeCookies) {
      const negated = `not (http.cookie contains "${cookie}=`;
      if (!allow.expression.includes(negated)) {
        failures.push(`${tag} does not exclude the ${cookie} cookie`);
      }
    }
    for (const lang of languageSignals) {
      const negated = `not (any(http.request.headers["accept-language"][*] wildcard "*${lang}*"))`;
      if (!allow.expression.toLowerCase().includes(negated.toLowerCase())) {
        failures.push(`${tag} does not exclude Accept-Language containing ${lang}`);
      }
    }
  }

  const prefixes = contract.bypass?.onRequestCookiePrefixes ?? [];
  for (const prefix of prefixes) {
    if (!bypasses.some((rule) => rule.expression.includes(`"${prefix}"`))) {
      failures.push(`no bypass rule for request cookie prefix ${prefix}`);
    }
  }

  for (const cookie of localeCookies) {
    // Covered by a dedicated bypass rule OR the path catch-all that denies
    // every /cafes/* request the allow rule did not override (v9 order).
    if (
      !bypasses.some(
        (rule) =>
          rule.expression.includes(`"${cookie}=`) ||
          rule.expression === catchAll,
      )
    ) {
      failures.push(`no bypass covers request cookie ${cookie}`);
    }
  }

  for (const lang of languageSignals) {
    if (
      !bypasses.some(
        (rule) =>
          rule.expression.includes(`"*${lang}*"`) ||
          rule.expression === catchAll,
      )
    ) {
      failures.push(`no bypass covers Accept-Language containing ${lang}`);
    }
  }

  const hostnames = contract.bypass?.onHostnames ?? [];
  for (const host of hostnames) {
    if (!bypasses.some((rule) => rule.expression.includes(`"${host}"`))) {
      failures.push(`no bypass rule for host ${host}`);
    }
  }

  if (
    contract.sharedCacheAcrossLocales === false &&
    localeCookies.length + languageSignals.length === 0
  ) {
    failures.push(
      "contract declares sharedCacheAcrossLocales: false but names no request signal to enforce it",
    );
  }

  // A response carrying Set-Cookie must not sit in shared cache. The payload
  // implements this in the response phase, where the edge can see the response
  // header: a /cafes/* response that sets a cookie is pinned no-store. The
  // request-side session-cookie bypass covers the session-refresh path, but it
  // is a request-side proxy for a response-side property, so the response rule
  // is what makes the contract clause enforceable at the edge.
  if (contract.bypass?.onResponseSetCookie) {
    const responseRules = payload.response?.rules ?? [];
    const covered = responseRules.some(
      (rule) =>
        rule.action === "set_cache_control" &&
        rule.action_parameters?.["no-store"]?.operation === "set" &&
        rule.expression.includes('http.response.headers["set-cookie"]'),
    );
    if (!covered) {
      failures.push(
        "onResponseSetCookie is declared but no response-phase rule pins Set-Cookie responses no-store",
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Shape: the payload declares the phases the applier will PUT to
// ---------------------------------------------------------------------------

/**
 * The applier builds the PUT URL from the payload's own `phase` field, so a
 * payload that names a different phase would be uploaded to an entrypoint its
 * rules were never checked against (BRAWUKA-837). The mapping is fixed by the
 * Cloudflare Rulesets API.
 */
const PHASE_NAMES = {
  request: "http_request_cache_settings",
  response: "http_response_cache_settings",
};

export function checkShape(payload) {
  const failures = [];
  for (const [key, expected] of Object.entries(PHASE_NAMES)) {
    const phase = payload[key];
    if (phase === undefined) {
      failures.push(`payload has no ${key} phase`);
      continue;
    }
    if (phase.phase !== expected) {
      failures.push(
        `payload.${key}.phase is ${JSON.stringify(phase.phase)}, expected ${JSON.stringify(expected)}`,
      );
    }
    if (!Array.isArray(phase.rules)) {
      failures.push(`payload.${key}.rules is not an array`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// All checks — the single entry point the CLI and tests share.
// ---------------------------------------------------------------------------

export function checkCachePolicy(contract, payload) {
  const shape = checkShape(payload);
  const coverage = checkCoverage(contract, payload);
  const { failures: outcomeFailures, outcomes } = checkOutcomes(payload);
  const { failures: responseFailures, outcomes: responseOutcomes } =
    checkResponseOutcomes(payload);
  return {
    failures: [...shape, ...coverage, ...outcomeFailures, ...responseFailures],
    outcomes,
    responseOutcomes,
  };
}
