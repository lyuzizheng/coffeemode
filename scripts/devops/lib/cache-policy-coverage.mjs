/**
 * Contract coverage: the payload must implement every declared requirement
 * (BRAWUKA-834 / BRAWUKA-836 / BRAWUKA-837).
 *
 * The contract (deploy/dokploy/cache-rules.json) has no custom cache keys —
 * unavailable on this zone's plan — so its signals live under `bypass.*`.
 * These checks assert the deployable payload implements each clause; extra
 * strictness is fine. Split out of cache-policy-checks.mjs: outcome probes
 * and phase-shape checks live there; this module owns (contract, payload)
 *  coverage only — pure, no I/O.
 */

import { topLevelConjuncts } from "./rules-language.mjs";

/** Top-level conjuncts through the shared tokenizer — `[]` when the
 *  expression is outside the grammar, which is itself a fail-closed miss:
 *  no exact-conjunct requirement can be satisfied by a term list that does
 *  not exist. String/escape/depth boundaries cannot drift from the
 *  evaluator because they ARE the evaluator's (BRAWUKA-841 r8). */
function conjuncts(expression) {
  try {
    return topLevelConjuncts(expression);
  } catch {
    return [];
  }
}


function statusCovered(entry, status) {
  if (entry.status_code !== undefined) return entry.status_code === status;
  const range = entry.status_code_range ?? {};
  return status >= (range.from ?? 200) && status <= (range.to ?? 599);
}

/** Per-allow scope check: the rule must bind every declared scope path. */
function checkAllowScope(failures, allow, tag, scopePaths) {
  const terms = new Set(conjuncts(allow.expression));
  for (const scopePath of scopePaths) {
    const prefix = scopePath.replace(/\*+$/, "");
    const bound = `starts_with(http.request.uri.path, "${prefix}")`;
    if (!terms.has(bound)) {
      failures.push(`${tag} does not scope ${scopePath}`);
    }
  }
}

/** Per-allow status pins: every status outside `cacheable.statuses` needs a
 *  status_code_ttl no-store entry on the allow rule. 304 is exempt on
 *  purpose: Cloudflare inherits the 200 TTL for 304 when no explicit TTL is
 *  set, and an explicit no-store on 304 makes every subsequent request
 *  revalidate (developers.cloudflare.com/cache/how-to/
 *  configure-cache-status-code/). A 304 carries no body, so it cannot
 *  store a stale shell. */
function checkAllowStatuses(failures, allow, tag, cacheable) {
  const noStore = (allow.action_parameters.edge_ttl?.status_code_ttl ?? []).filter(
    (entry) => entry.value === -1,
  );
  for (let status = 200; status <= 599; status += 1) {
    if (cacheable.has(status) || status === 304) continue;
    if (!noStore.some((entry) => statusCovered(entry, status))) {
      failures.push(`status ${status} is not pinned no-store on the ${tag}`);
    }
  }
}

/** Per-allow TTL semantics: respect_origin is what makes the contract's
 *  s-maxage / stale-while-revalidate meaningful — an override would silently
 *  ignore the origin TTL (BRAWUKA-836). strong ETags are required for SWR
 *  revalidation. */
function checkAllowTtl(failures, allow, tag, cacheable) {
  if (cacheable.statuses.size === 0) return;
  const edgeTtl = allow.action_parameters?.edge_ttl;
  if (!edgeTtl || edgeTtl.mode !== "respect_origin") {
    failures.push(`${tag} must keep edge_ttl.mode=respect_origin`);
  }
  if (cacheable.swrSeconds > 0 && allow.action_parameters?.respect_strong_etags !== true) {
    failures.push(`${tag} needs respect_strong_etags for stale-while-revalidate`);
  }
}

/** The exact conjunct a cache-eligible rule must carry so it can never
 *  match a request a declared bypass covers — the edge only knows
 *  expressions, so a textual negation is the enforceable exclusion.
 *  `not(X)` conjuncts negate; `http.host ne` is self-negating. */
function exclusionConjunct(kind, value) {
  switch (kind) {
    case "cookiePrefix":
      return `not (http.cookie contains "${value}")`;
    case "cookie":
      return `not (http.cookie contains "${value}=")`;
    case "acceptLanguage":
      return `not (any(http.request.headers["accept-language"][*] wildcard "*${value}*"))`;
    case "hostname":
      return `http.host ne "${value}"`;
    default:
      return null;
  }
}

/** Per-allow signal exclusions: EVERY declared bypass signal must appear
 *  as an exact top-level conjunct on EVERY allow rule — substring matching
 *  admits text inside a negated group (r7) or an `or` branch (r4); a `"`
 *  escape inside a literal corrupts a character-level scanner's depth the
 *  same way, so the terms come from the shared tokenizer (r8). */
function checkAllowSignalExclusions(failures, allow, tag, signals) {
  const terms = conjuncts(allow.expression);
  for (const { kind, value } of signals.all) {
    const required = exclusionConjunct(kind, value);
    if (required !== null && !terms.includes(required)) {
      failures.push(`${tag} does not exclude ${kind} "${value}"`);
    }
  }
}

/** Per-allow contract: one cache-eligible rule must scope its paths, pin
 *  non-cacheable statuses, keep TTL semantics, and exclude every declared
 *  bypass signal. */
function checkAllowRule(failures, allow, contract, signals) {
  const tag = `cache-eligible rule "${allow.description || allow.expression.slice(0, 60)}"`;
  const cacheableContract = contract.cacheable ?? {};
  const cacheable = new Set(cacheableContract.statuses ?? []);
  checkAllowScope(failures, allow, tag, contract.scope?.paths ?? []);
  checkAllowStatuses(failures, allow, tag, cacheable);
  checkAllowTtl(failures, allow, tag, {
    statuses: cacheable,
    swrSeconds: cacheableContract.staleWhileRevalidateSeconds ?? 0,
  });
  checkAllowSignalExclusions(failures, allow, tag, signals);
}

/** The exact expression a dedicated bypass rule must BE so it bypasses
 *  every matching request — a signal buried inside a longer conjunction
 *  (`http.cookie contains "sb-" and http.cookie contains "x"`) only
 *  bypasses requests that satisfy the extra terms, silently narrowing the
 *  declared bypass (same burial class as the allow-side r5/r7 findings). */
function bypassTerm(kind, value) {
  switch (kind) {
    case "cookiePrefix":
      return `http.cookie contains "${value}"`;
    case "cookie":
      return `http.cookie contains "${value}="`;
    case "acceptLanguage":
      return `any(http.request.headers["accept-language"][*] wildcard "*${value}*")`;
    case "hostname":
      return `http.host eq "${value}"`;
    default:
      return null;
  }
}

/** Required bypass coverage: each declared signal needs an ACTIVE rule
 *  whose expression IS the signal term. Zone-wide signals (auth cookie
 *  prefix, bypass hostnames — spec 0005 §3 covers every staging route)
 *  need that dedicated rule; the /cafes/ catch-all only denies in-scope
 *  paths, so it satisfies locale signals (cookie + Accept-Language) but
 *  never zone-wide ones. */
function checkBypassCoverage(failures, contract, bypasses, signals) {
  const catchAll = 'starts_with(http.request.uri.path, "/cafes/")';
  for (const { kind, value } of signals.all) {
    const required = bypassTerm(kind, value);
    const dedicated =
      required !== null && bypasses.some((rule) => rule.expression === required);
    const catchAllOk =
      (kind === "cookie" || kind === "acceptLanguage") &&
      bypasses.some((rule) => rule.expression === catchAll);
    if (!dedicated && !catchAllOk) {
      failures.push(`no bypass covers ${kind} "${value}"`);
    }
  }
  if (
    contract.sharedCacheAcrossLocales === false &&
    signals.localeCookies.length + signals.languageSignals.length === 0
  ) {
    failures.push(
      "contract declares sharedCacheAcrossLocales: false but names no request signal to enforce it",
    );
  }
}

/** A response carrying Set-Cookie must not sit in shared cache. The payload
 *  implements this in the response phase, where the edge can see the response
 *  header: a /cafes/* response that sets a cookie is pinned no-store. The
 *  request-side session-cookie bypass covers the session-refresh path, but it
 *  is a request-side proxy for a response-side property, so the response rule
 *  is what makes the contract clause enforceable at the edge. The set-cookie
 *  term must be an exact top-level conjunct — inside a literal or a negated
 *  group it asserts nothing (same class as the request-side r8 finding). */
function checkResponseCoverage(failures, contract, payload) {
  if (!contract.bypass?.onResponseSetCookie) return;
  const responseRules = payload.response?.rules ?? [];
  const covered = responseRules.some(
    (rule) =>
      rule.action === "set_cache_control" &&
      rule.action_parameters?.["no-store"]?.operation === "set" &&
      conjuncts(rule.expression).includes(
        'any(http.response.headers["set-cookie"][*] ne "")',
      ),
  );
  if (!covered) {
    failures.push(
      "onResponseSetCookie is declared but no response-phase rule pins Set-Cookie responses no-store",
    );
  }
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

  const signals = {
    localeCookies: contract.bypass?.onRequestCookies ?? [],
    languageSignals: contract.bypass?.onAcceptLanguageContains ?? [],
    all: [
      ...(contract.bypass?.onRequestCookiePrefixes ?? []).map((value) => ({
        kind: "cookiePrefix",
        value,
      })),
      ...(contract.bypass?.onRequestCookies ?? []).map((value) => ({
        kind: "cookie",
        value,
      })),
      ...(contract.bypass?.onAcceptLanguageContains ?? []).map((value) => ({
        kind: "acceptLanguage",
        value,
      })),
      ...(contract.bypass?.onHostnames ?? []).map((value) => ({
        kind: "hostname",
        value,
      })),
    ],
  };
  for (const allow of allows) {
    checkAllowRule(failures, allow, contract, signals);
  }
  checkBypassCoverage(failures, contract, bypasses, signals);
  checkResponseCoverage(failures, contract, payload);
  return failures;
}
