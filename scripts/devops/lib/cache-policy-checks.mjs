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
import { checkCoverage } from "./cache-policy-coverage.mjs";

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
