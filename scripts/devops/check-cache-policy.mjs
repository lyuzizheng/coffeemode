#!/usr/bin/env node
/**
 * Check the Cloudflare edge cache payload against the cache policy contract
 * (BRAWUKA-834 / BRAWUKA-836).
 *
 * Both files are GENERATED from one source — `web/config/app.yaml`
 * `seo.shellCache` via `web/lib/cache-policy.ts`
 * (`npm run gen:cache-rules`; BRAWUKA-821):
 *
 *   deploy/dokploy/cache-rules.json             the contract — declared
 *                                               bypass signals, TTLs, the
 *                                               sharedCacheAcrossLocales
 *                                               invariant
 *   deploy/dokploy/cloudflare-cache-rules.json  the deployable payload the
 *                                               zone runs
 *
 * The contract has no custom cache keys (unavailable on this zone's plan),
 * so its signals live under `bypass.*`. This script is the checked
 * relationship between the files: **the payload must implement every
 * declared bypass signal**, and extra strictness is fine.
 *
 * It also evaluates the payload's rules the way Cloudflare does — rules run in
 * order and the **last matching** action wins — for representative requests, in
 * both phases: a request-phase order that makes the cache-eligible rule
 * unreachable, or a response-phase rule that fails to pin a Set-Cookie response
 * no-store, fails here instead of in production (BRAWUKA-836). The evaluator
 * lives in ./lib/rules-language.mjs.
 *
 * The payload's declared phase names are checked too (BRAWUKA-837): the applier
 * builds the PUT URL from them, so a payload that names a different phase would
 * be uploaded to an entrypoint its rules were never checked against.
 *
 * Usage:
 *   node scripts/devops/check-cache-policy.mjs [--payload <path>] [--contract <path>] [--json]
 *
 * Exit code 0 = the payload implements the contract and every representative
 * request gets the intended cache setting.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateResponseRules, evaluateRules } from "./lib/rules-language.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_CONTRACT = path.join(REPO_ROOT, "deploy/dokploy/cache-rules.json");
const DEFAULT_PAYLOAD = path.join(REPO_ROOT, "deploy/dokploy/cloudflare-cache-rules.json");

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

function checkOutcomes(payload) {
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

function checkResponseOutcomes(payload) {
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
 * The app resolves the locale as cookie -> Accept-Language -> default
 * (web/i18n/request.ts), so `sharedCacheAcrossLocales: false` requires the
 * payload to exclude BOTH signals. The cookie name is read from the app rather
 * than hardcoded, so renaming it cannot silently drop the exclusion.
 */
function localeCookieName(contract) {
  const declared = contract.bypass?.onRequestCookies ?? contract.varyOnCookies;
  if (Array.isArray(declared) && declared.length > 0) return declared[0];
  const source = readFileSync(path.join(REPO_ROOT, "web/i18n/request.ts"), "utf8");
  const match = /cookies\(\)\)\s*\.get\(\s*"([^"]+)"\s*\)/.exec(source);
  if (!match) {
    throw new Error("cannot read the locale cookie name from web/i18n/request.ts");
  }
  return match[1];
}

function checkCoverage(contract, payload) {
  const failures = [];
  const rules = payload.request?.rules ?? [];
  const allow = rules.find((rule) => rule.action_parameters?.cache === true);
  const bypasses = rules.filter((rule) => rule.action_parameters?.cache === false);

  if (!allow) {
    failures.push("payload has no cache-eligible rule");
    return failures;
  }

  for (const scopePath of contract.scope?.paths ?? []) {
    const prefix = scopePath.replace(/\*+$/, "");
    if (!allow.expression.includes(`"${prefix}"`)) {
      failures.push(`cache-eligible rule does not scope ${scopePath}`);
    }
  }

  const cacheableContract = contract.cacheable ?? {};
  const cacheable = new Set(cacheableContract.statuses ?? []);
  const noStore = (allow.action_parameters.edge_ttl?.status_code_ttl ?? []).filter(
    (entry) => entry.value === -1,
  );
  for (let status = 200; status <= 599; status += 1) {
    if (cacheable.has(status)) continue;
    // 304 is exempt on purpose: Cloudflare inherits the 200 TTL for 304 when no
    // explicit TTL is set, and an explicit no-store on 304 makes every
    // subsequent request revalidate ("this cycle will persist" —
    // developers.cloudflare.com/cache/how-to/configure-cache-status-code/).
    // A 304 carries no body, so it cannot store a stale shell.
    if (status === 304) continue;
    if (!noStore.some((entry) => statusCovered(entry, status))) {
      failures.push(`status ${status} is not pinned no-store on the cache-eligible rule`);
    }
  }

  // TTL semantics: respect_origin is what makes the contract's s-maxage /
  // stale-while-revalidate meaningful — an override would silently ignore
  // the origin TTL. strong ETags are required for SWR revalidation.
  if (cacheable.size > 0) {
    const edgeTtl = allow.action_parameters?.edge_ttl;
    if (!edgeTtl || edgeTtl.mode !== "respect_origin") {
      failures.push("cache-eligible rule must keep edge_ttl.mode=respect_origin");
    }
    if (
      (cacheableContract.staleWhileRevalidateSeconds ?? 0) > 0 &&
      allow.action_parameters?.respect_strong_etags !== true
    ) {
      failures.push("stale-while-revalidate needs respect_strong_etags: true");
    }
  }

  const prefixes = contract.bypass?.onRequestCookiePrefixes ?? [];
  for (const prefix of prefixes) {
    if (!bypasses.some((rule) => rule.expression.includes(`"${prefix}"`))) {
      failures.push(`no bypass rule for request cookie prefix ${prefix}`);
    }
  }

  const localeCookies =
    contract.sharedCacheAcrossLocales === false
      ? [localeCookieName(contract)]
      : (contract.bypass?.onRequestCookies ?? contract.varyOnCookies ?? []);
  const catchAll = 'starts_with(http.request.uri.path, "/cafes/")';
  for (const cookie of localeCookies) {
    if (!allow.expression.includes(`"${cookie}`)) {
      failures.push(`cache-eligible rule does not exclude the ${cookie} cookie`);
    }
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

  // Header-side locale signals live under bypass.onAcceptLanguageContains
  // (bypass contract — no custom keys): the allow rule must gate on
  // Accept-Language and each declared value must be covered by a bypass
  // (dedicated rule or the path catch-all).
  const languageSignals = contract.bypass?.onAcceptLanguageContains ?? [];
  if (languageSignals.length > 0) {
    if (!allow.expression.toLowerCase().includes("accept-language")) {
      failures.push("cache-eligible rule does not gate on Accept-Language");
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
  }

  const hostnames = contract.bypass?.onHostnames ?? [];
  for (const host of hostnames) {
    if (!bypasses.some((rule) => rule.expression.includes(`"${host}"`))) {
      failures.push(`no bypass rule for host ${host}`);
    }
  }

  if (
    contract.sharedCacheAcrossLocales === false &&
    (contract.bypass?.onRequestCookies ?? []).length +
      languageSignals.length ===
      0
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

function checkShape(payload) {
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
// CLI
// ---------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main(argv) {
  let contractPath = DEFAULT_CONTRACT;
  let payloadPath = DEFAULT_PAYLOAD;
  let asJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--contract") {
      contractPath = path.resolve(argv[(index += 1)]);
    } else if (arg === "--payload") {
      payloadPath = path.resolve(argv[(index += 1)]);
    } else if (arg === "--json") {
      asJson = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: check-cache-policy.mjs [--contract <path>] [--payload <path>] [--json]\n",
      );
      return 0;
    } else {
      process.stderr.write(`unknown argument ${arg}\n`);
      return 2;
    }
  }

  const contract = readJson(contractPath);
  const payload = readJson(payloadPath);
  const shape = checkShape(payload);
  const coverage = checkCoverage(contract, payload);
  const { failures: outcomeFailures, outcomes } = checkOutcomes(payload);
  const { failures: responseFailures, outcomes: responseOutcomes } =
    checkResponseOutcomes(payload);
  const failures = [...shape, ...coverage, ...outcomeFailures, ...responseFailures];

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        { ok: failures.length === 0, failures, outcomes, responseOutcomes },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`contract: ${path.relative(REPO_ROOT, contractPath)}\n`);
    process.stdout.write(`payload:  ${path.relative(REPO_ROOT, payloadPath)}\n\n`);
    for (const outcome of outcomes) {
      const verdict = outcome.actual === outcome.expected ? "ok  " : "FAIL";
      process.stdout.write(`${verdict} cache=${String(outcome.actual)} ${outcome.name}\n`);
    }
    for (const outcome of responseOutcomes) {
      const verdict = outcome.actual === outcome.expected ? "ok  " : "FAIL";
      process.stdout.write(
        `${verdict} no_store=${String(outcome.actual)} ${outcome.name}\n`,
      );
    }
    for (const failure of failures) {
      process.stdout.write(`\nFAIL ${failure}\n`);
    }
    process.stdout.write(
      failures.length === 0
        ? "\ncache policy check passed.\n"
        : `\ncache policy check FAILED (${failures.length}).\n`,
    );
  }

  return failures.length === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
