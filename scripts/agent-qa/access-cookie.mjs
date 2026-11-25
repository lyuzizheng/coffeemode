/**
 * Agent-QA Cloudflare Access cookie bootstrap (BRAWUKA-1026).
 *
 * Root cause of the 2026-11-20 `env-failure:access-cookie-shadowed`: the QA
 * browser ran on Owner's personal ego profile, whose cookie jar is shared with
 * Owner's tabs and every other task space on that profile. A session
 * `CF_Authorization` scoped to `.cafemood.app` came along with it. Cloudflare
 * picks one same-name cookie; the parent-domain cookie won, so every Document
 * navigation answered 302 and Chromium stopped at the Access login page. The
 * host-only cookie the runner stamped was present and valid but never used.
 *
 * Two invariants make that failure unrepresentable:
 *
 * 1. **Dedicated profile.** The QA space is created with
 *    `taskSpace(name, { profileId: AGENT_QA_EGO_PROFILE_ID })`. ego lite's
 *    built-in `Default` profile is separate from Owner's `Profile 1`, so
 *    deleting a `.cafemood.app` cookie there can never sign Owner out of
 *    production. Purging on the shared profile would.
 * 2. **One host-only cookie.** Before the first navigation, delete every
 *    `CF_Authorization` that would be SENT to the staging host but is not the
 *    host-only one, trade the service-token pair for a fresh cookie, stamp it
 *    host-only via `Network.setCookie` (`url`, never `domain`), then read the
 *    jar back and assert exactly one host-only cookie. Any violation fails the
 *    run as `env-failure:access-cookie-shadowed` instead of burning a journey
 *    round on the login page.
 *
 * Usage inside an ego-browser Node script (absolute path — that runtime does
 * not inherit the shell's working directory):
 *
 * ```js
 * const { ensureSingleAccessCookie, resolveAgentQaProfile } = await import(
 *   "/abs/repo/scripts/agent-qa/access-cookie.mjs"
 * );
 * const profile = resolveAgentQaProfile(await profiles());
 * const task = await taskSpace("CoffeeMode agent QA", { profileId: profile.id });
 * const page = task.page("p1");
 * const pair = await loadAccessEnvFile("/abs/bridge.env");
 * const { purgedDomains } = await ensureSingleAccessCookie(page, {
 *   stagingUrl: "https://staging.cafemood.app/api/health",
 *   pair,
 * });
 * // domains only — values and tokens never leave the helper
 * ```
 *
 * Secret boundary: the cookie value flows from the bootstrap response into
 * `Network.setCookie` and nowhere else. This module never returns it and never
 * logs it; `fetchAccessCookie` rejects non-Access hosts so the service-token
 * pair cannot be sent to a third-party origin (BRAWUKA-508/593).
 */

import { isAccessHost } from "./allowlist.mjs";

/** Name Cloudflare Access uses for the session cookie. */
export const ACCESS_COOKIE_NAME = "CF_Authorization";

/**
 * User agent for the token-pair fetch. Staging sits behind a bot-challenge
 * layer that 403s a non-browser UA (the QA preflight curls with a browser UA
 * for the same reason), so the request presents the browser's own identity.
 * `ensureSingleAccessCookie` reads the live Chromium UA; this constant is the
 * direct-call fallback and the shape the 2026-11-20 evidence proved with a 200.
 */
export const ACCESS_FALLBACK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

/**
 * ego lite profile reserved for automated QA: the built-in profile, NOT the
 * Owner's imported `Profile 1`. `profiles()` ids are stable per install.
 */
export const AGENT_QA_EGO_PROFILE_ID = "Default";

/**
 * Resolve the dedicated QA profile from `profiles()`. Fail-closed: a missing
 * profile aborts the round with the run-log signature the QA runner files as
 * an environment failure — never fall back to the shared profile.
 *
 * @param {Array<{ id?: string, name?: string, isDefault?: boolean }> | undefined} profiles result of `profiles()`
 * @returns {{ id: string, name?: string, isDefault?: boolean }}
 */
export function resolveAgentQaProfile(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  const profile = list.find((entry) => entry?.id === AGENT_QA_EGO_PROFILE_ID);
  if (!profile) {
    throw new Error(
      `Agent-QA dedicated browser profile "${AGENT_QA_EGO_PROFILE_ID}" is missing (env-failure:qa-profile-missing). ` +
        "Do not fall back to the shared profile: its cookie jar carries Owner's parent-domain cookies.",
    );
  }
  return profile;
}

/**
 * Would a cookie on `domain` be sent to `host`? RFC 6265 domain matching: the
 * domain itself (leading dot optional) or any parent suffix. Fail-closed on
 * empty input.
 *
 * @param {unknown} domain cookie domain, with or without the leading dot
 * @param {unknown} host request hostname
 * @returns {boolean}
 */
export function cookieDomainApplies(domain, host) {
  const cookieDomain = String(domain ?? "").toLowerCase().replace(/\.+$/, "");
  const requestHost = String(host ?? "").toLowerCase().replace(/\.+$/, "");
  if (cookieDomain === "" || requestHost === "") return false;
  const bare = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  return requestHost === bare || requestHost.endsWith(`.${bare}`);
}

/**
 * True only for the exact host with no leading dot — the shape
 * `Network.setCookie({ url })` produces and the only shape this bootstrap
 * accepts.
 *
 * @param {{ domain?: string }} cookie CDP cookie
 * @param {string} host request hostname
 * @returns {boolean}
 */
export function isHostOnlyCookieFor(cookie, host) {
  const domain = String(cookie?.domain ?? "");
  return domain !== "" && !domain.startsWith(".") && domain.toLowerCase().replace(/\.+$/, "") === host.toLowerCase();
}

/**
 * Every `CF_Authorization` that would be sent to `host` but is not host-only:
 * parent-domain cookies, a domain cookie naming the host explicitly (leading
 * dot), and anything above the host. Values are never inspected.
 *
 * @param {Array<{ name?: string, domain?: string }> | undefined} cookies `Network.getAllCookies` result
 * @param {string} host request hostname
 * @returns {Array<{ name: string, domain: string, path?: string }>}
 */
export function shadowingAccessCookies(cookies, host) {
  const out = [];
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (cookie?.name !== ACCESS_COOKIE_NAME) continue;
    if (!cookieDomainApplies(cookie.domain, host)) continue;
    if (isHostOnlyCookieFor(cookie, host)) continue;
    out.push(cookie);
  }
  return out;
}

/**
 * Assert the jar holds exactly one host-only `CF_Authorization` for `host`.
 * Throws with the count and domains — never the values.
 *
 * @param {Array<{ name?: string, domain?: string }>} cookies cookies applicable to the host
 * @param {string} host request hostname
 */
export function assertSingleHostOnlyAccessCookie(cookies, host) {
  const applicable = (Array.isArray(cookies) ? cookies : []).filter(
    (cookie) => cookie?.name === ACCESS_COOKIE_NAME && cookieDomainApplies(cookie.domain, host),
  );
  const domains = applicable.map((cookie) => String(cookie.domain));
  if (applicable.length === 1 && isHostOnlyCookieFor(applicable[0], host)) return;
  throw new Error(
    `env-failure:access-cookie-shadowed — expected exactly one host-only ${ACCESS_COOKIE_NAME} for ${host}, ` +
      `found ${applicable.length}${domains.length > 0 ? ` (domains: ${domains.join(", ")})` : ""}.`,
  );
}

/**
 * Read the `CF_Authorization` value out of a bootstrap response's `Set-Cookie`
 * headers. First match wins; `null` when absent.
 *
 * @param {{ getSetCookie?: () => string[] } | undefined} headers fetch response headers
 * @param {string} [name] cookie name (default CF_Authorization)
 * @returns {string | null}
 */
export function readAccessCookieValue(headers, name = ACCESS_COOKIE_NAME) {
  const setCookies = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escaped}=([^;]*)`);
  for (const raw of setCookies) {
    const match = pattern.exec(String(raw));
    if (match && match[1] !== "") return match[1];
  }
  return null;
}

/**
 * Trade the service-token pair for a `CF_Authorization` value with a direct
 * Node fetch — never a browser request, so the pair stays out of the page and
 * away from third-party origins. Redirects are NOT followed: a 3xx means the
 * Access application rejected the token and the run must stop. The request
 * carries a browser user agent because the staging bot layer challenges
 * anything else.
 *
 * @param {string} stagingUrl Access-protected staging URL (must be an Access host)
 * @param {{ clientId: string, clientSecret: string }} pair resolved token pair
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, userAgent?: string }} [opts]
 * @returns {Promise<string>} the cookie value (header-only; never logged)
 */
export async function fetchAccessCookie(
  stagingUrl,
  pair,
  { fetchImpl = globalThis.fetch, timeoutMs = 10_000, userAgent = ACCESS_FALLBACK_USER_AGENT } = {},
) {
  const url = new URL(String(stagingUrl));
  if (!isAccessHost(url.hostname)) {
    throw new Error(
      `Agent-QA Access cookie bootstrap refused: host "${url.hostname}" is not an Access host; ` +
        "the service-token pair must never leave the staging allowlist.",
    );
  }
  const res = await fetchImpl(url.href, {
    method: "GET",
    redirect: "manual",
    headers: {
      "CF-Access-Client-Id": pair.clientId,
      "CF-Access-Client-Secret": pair.clientSecret,
      "user-agent": userAgent,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Agent-QA Access cookie bootstrap got HTTP ${res.status} from ${url.pathname} ` +
        "(env-failure:access-token-rejected).",
    );
  }
  const value = readAccessCookieValue(res.headers);
  if (value === null) {
    throw new Error(
      `Agent-QA Access cookie bootstrap returned no ${ACCESS_COOKIE_NAME} (env-failure:access-token-rejected).`,
    );
  }
  return value;
}

/**
 * Stamp the value host-only. `url` (never `domain`) is what makes the cookie
 * host-only; a `domain` value would create exactly the parent-domain duplicate
 * this module exists to prevent.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown> }} page ego-browser Page
 * @param {string} stagingUrl Access-protected staging URL
 * @param {string} value cookie value
 */
export async function stampHostOnlyAccessCookie(page, stagingUrl, value) {
  const url = new URL(String(stagingUrl));
  const result = await page.cdp("Network.setCookie", {
    name: ACCESS_COOKIE_NAME,
    value,
    url: `${url.origin}/`,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "None",
  });
  if (result && result.success === false) {
    throw new Error(
      `env-failure:access-cookie-shadowed — Chromium rejected the host-only ${ACCESS_COOKIE_NAME} for ${url.hostname}.`,
    );
  }
}

/**
 * Delete every non-host-only `CF_Authorization` that would reach the staging
 * host, then read the jar back and fail closed if any survived. Scoped
 * `Network.deleteCookies` only — never a profile-wide clear. Returns the
 * deleted domains (no values) for the run log.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown> }} page ego-browser Page
 * @param {string} host staging hostname
 * @returns {Promise<string[]>} purged cookie domains
 */
export async function purgeShadowingAccessCookies(page, host) {
  const { cookies } = await page.cdp("Network.getAllCookies");
  const doomed = shadowingAccessCookies(cookies, host);
  for (const cookie of doomed) {
    await page.cdp("Network.deleteCookies", {
      name: ACCESS_COOKIE_NAME,
      domain: cookie.domain,
      path: cookie.path ?? "/",
    });
  }
  const after = (await page.cdp("Network.getAllCookies")).cookies;
  const survivors = shadowingAccessCookies(after, host);
  if (survivors.length > 0) {
    throw new Error(
      `env-failure:access-cookie-shadowed — ${survivors.length} non-host-only ${ACCESS_COOKIE_NAME} cookie(s) survived deletion ` +
        `(domains: ${survivors.map((cookie) => cookie.domain).join(", ")}).`,
    );
  }
  return doomed.map((cookie) => String(cookie.domain));
}

/**
 * Read the cookies Chromium would send to the staging origin root and assert
 * the single host-only invariant. Safe to call before every journey, after a
 * redirect that may have reissued cookies.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown> }} page ego-browser Page
 * @param {string} stagingUrl staging URL
 * @returns {Promise<number>} number of `CF_Authorization` cookies applicable (always 1)
 */
export async function verifySingleAccessCookie(page, stagingUrl) {
  const url = new URL(String(stagingUrl));
  const { cookies } = await page.cdp("Network.getCookies", { urls: [`${url.origin}/`] });
  assertSingleHostOnlyAccessCookie(cookies, url.hostname);
  return (cookies ?? []).filter((cookie) => cookie?.name === ACCESS_COOKIE_NAME).length;
}

/**
 * Full bootstrap: purge shadows → fetch a fresh value with the token pair →
 * stamp host-only → verify. Call once per round, before the first `goto()`.
 *
 * The token-pair fetch presents the live Chromium user agent so the staging bot
 * layer sees the same identity as the browser that will use the cookie.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown>, evaluate?: (fn: () => unknown) => Promise<unknown> }} page ego-browser Page
 * @param {{ stagingUrl: string, pair: { clientId: string, clientSecret: string }, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ purgedDomains: string[] }>}
 */
export async function ensureSingleAccessCookie(page, { stagingUrl, pair, fetchImpl }) {
  const host = new URL(String(stagingUrl)).hostname;
  const purgedDomains = await purgeShadowingAccessCookies(page, host);
  const browserUa = await Promise.resolve()
    .then(() => page.evaluate?.(() => navigator.userAgent))
    .catch(() => "");
  const userAgent =
    typeof browserUa === "string" && browserUa.startsWith("Mozilla/") ? browserUa : ACCESS_FALLBACK_USER_AGENT;
  const value = await fetchAccessCookie(stagingUrl, pair, { fetchImpl, userAgent });
  await stampHostOnlyAccessCookie(page, stagingUrl, value);
  await verifySingleAccessCookie(page, stagingUrl);
  return { purgedDomains };
}
