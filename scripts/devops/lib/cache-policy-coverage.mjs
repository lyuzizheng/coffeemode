/**
 * Contract coverage: the payload must implement every declared requirement
 * (BRAWUKA-834 / BRAWUKA-836 / BRAWUKA-837).
 *
 * The contract (deploy/dokploy/cache-rules.json) has no custom cache keys —
 * unavailable on this zone's plan — so its signals live under `bypass.*`.
 * These checks assert the deployable payload implements each clause; extra
 * strictness is fine. Split out of cache-policy-checks.mjs: outcome probes
 * and phase-shape checks live there; this module owns (contract, payload)
 * coverage only — pure, no I/O.
 */


function statusCovered(entry, status) {
  if (entry.status_code !== undefined) return entry.status_code === status;
  const range = entry.status_code_range ?? {};
  return status >= (range.from ?? 200) && status <= (range.to ?? 599);
}

/** Per-allow scope check: the rule must bind every declared scope path. */
function checkAllowScope(failures, allow, tag, scopePaths) {
  for (const scopePath of scopePaths) {
    const prefix = scopePath.replace(/\*+$/, "");
    if (!allow.expression.includes(`"${prefix}"`)) {
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
function checkAllowTtl(failures, allow, tag, cacheable, swrSeconds) {
  if (cacheable.size === 0) return;
  const edgeTtl = allow.action_parameters?.edge_ttl;
  if (!edgeTtl || edgeTtl.mode !== "respect_origin") {
    failures.push(`${tag} must keep edge_ttl.mode=respect_origin`);
  }
  if (swrSeconds > 0 && allow.action_parameters?.respect_strong_etags !== true) {
    failures.push(`${tag} needs respect_strong_etags for stale-while-revalidate`);
  }
}

/** Per-allow locale exclusions: they must hold on EVERY allow rule — a later
 *  allow that drops them caches non-default-locale requests the bypass
 *  contract forbids. Require the negated term: a positive
 *  `contains "locale="` in an allow expression is not an exclusion. */
function checkAllowLocaleExclusions(failures, allow, tag, localeCookies, languageSignals) {
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

/** Per-allow contract: one cache-eligible rule must scope its paths, pin
 *  non-cacheable statuses, keep TTL semantics, and exclude every locale
 *  signal. */
function checkAllowRule(failures, allow, contract, signals) {
  const tag = `cache-eligible rule "${allow.description || allow.expression.slice(0, 60)}"`;
  const cacheableContract = contract.cacheable ?? {};
  const cacheable = new Set(cacheableContract.statuses ?? []);
  checkAllowScope(failures, allow, tag, contract.scope?.paths ?? []);
  checkAllowStatuses(failures, allow, tag, cacheable);
  checkAllowTtl(failures, allow, tag, cacheable, cacheableContract.staleWhileRevalidateSeconds ?? 0);
  checkAllowLocaleExclusions(failures, allow, tag, signals.localeCookies, signals.languageSignals);
}

/** Required bypass coverage: every declared signal needs a dedicated bypass
 *  rule OR the path catch-all that denies every /cafes/* request the allow
 *  rule did not override (v9 order); host bypasses are zone-wide. */
function checkBypassCoverage(failures, contract, bypasses, signals) {
  const catchAll = 'starts_with(http.request.uri.path, "/cafes/")';
  for (const prefix of contract.bypass?.onRequestCookiePrefixes ?? []) {
    if (!bypasses.some((rule) => rule.expression.includes(`"${prefix}"`))) {
      failures.push(`no bypass rule for request cookie prefix ${prefix}`);
    }
  }
  for (const cookie of signals.localeCookies) {
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
  for (const lang of signals.languageSignals) {
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
  for (const host of contract.bypass?.onHostnames ?? []) {
    if (!bypasses.some((rule) => rule.expression.includes(`"${host}"`))) {
      failures.push(`no bypass rule for host ${host}`);
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
 *  is what makes the contract clause enforceable at the edge. */
function checkResponseCoverage(failures, contract, payload) {
  if (!contract.bypass?.onResponseSetCookie) return;
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
  };
  for (const allow of allows) {
    checkAllowRule(failures, allow, contract, signals);
  }
  checkBypassCoverage(failures, contract, bypasses, signals);
  checkResponseCoverage(failures, contract, payload);
  return failures;
}
