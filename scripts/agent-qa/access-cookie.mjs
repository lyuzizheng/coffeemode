/**
 * Agent-QA Cloudflare Access cookie bootstrap (BRAWUKA-1026).
 *
 * Root cause: the QA browser ran on Owner's shared profile, so a session
 * `CF_Authorization` scoped to `.cafemood.app` travelled with it. Cloudflare
 * sends one same-name cookie; the parent-domain cookie won and every Document
 * navigation answered 302 while the host-only cookie sat unused.
 *
 * Contract: dedicated profile ({@link AGENT_QA_EGO_PROFILE_ID}); credentials
 * only for the exact origin {@link AGENT_QA_CREDENTIAL_ORIGIN}; and exactly one
 * canonical cookie for the staging host —
 * host-only at path `/`. {@link ensureSingleAccessCookie} purges every other
 * `CF_Authorization`, stamps a fresh host-only value, and verifies the jar.
 * Violations throw `env-failure:access-cookie-shadowed` before the first
 * navigation instead of burning a round on the login page.
 *
 * Usage in an ego-browser Node script (absolute path; that runtime does not
 * inherit the shell's cwd):
 *
 * ```js
 * const { ensureSingleAccessCookie, resolveAgentQaProfile } = await import(
 *   "/abs/repo/scripts/agent-qa/access-cookie.mjs"
 * );
 * const profile = resolveAgentQaProfile(await profiles());
 * const task = await taskSpace("CoffeeMode agent QA", { profileId: profile.id });
 * const pair = await loadAccessEnvFile("/abs/bridge.env");
 * await ensureSingleAccessCookie(task.page("p1"), {
 *   stagingUrl: "https://staging.cafemood.app/api/health",
 *   pair,
 * });
 * ```
 *
 * The cookie value flows from the bootstrap response into `Network.setCookie`
 * and nowhere else: no helper returns it and no error message includes it.
 */

/** Name Cloudflare Access uses for the session cookie. */
export const ACCESS_COOKIE_NAME = "CF_Authorization";

/** ego lite profile reserved for QA — the built-in one, never `Profile 1`. */
export const AGENT_QA_EGO_PROFILE_ID = "Default";

/**
 * The one URL allowed to receive the service-token pair. {@link parseStagingUrl}
 * requires both the `https:` protocol and this exact origin (scheme, host,
 * port). Navigation allowlists (`AGENT_QA_ALLOWED_HOSTS`) and the broader
 * header-injection hosts (`AGENT_QA_ACCESS_HOSTS`) never authorize credentials.
 */
export const AGENT_QA_CREDENTIAL_ORIGIN = "https://staging.cafemood.app";

/**
 * Resolve the dedicated QA profile from `profiles()`. Fail-closed; never falls
 * back to the shared profile.
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
 * Validate a staging URL before credentials or cookies touch it. The protocol
 * must be `https:` itself — `URL.origin` alone does not catch `blob:`, whose
 * origin serializes to the inner URL's — and the origin must equal
 * {@link AGENT_QA_CREDENTIAL_ORIGIN} exactly. `URL.origin` compares scheme,
 * host, and port, so an alternate port and any other Access tenant domain also
 * fail closed without a request.
 *
 * @param {unknown} stagingUrl absolute staging URL
 * @returns {URL}
 */
export function parseStagingUrl(stagingUrl) {
  const url = new URL(String(stagingUrl));
  if (url.protocol !== "https:") {
    throw new Error(
      `Agent-QA Access bootstrap refused protocol "${url.protocol}": credentials and Access cookies ` +
        `require an https: URL at ${AGENT_QA_CREDENTIAL_ORIGIN}.`,
    );
  }
  if (url.origin !== AGENT_QA_CREDENTIAL_ORIGIN) {
    throw new Error(
      `Agent-QA Access bootstrap refused origin "${url.origin}": credentials and Access cookies ` +
        `are limited to ${AGENT_QA_CREDENTIAL_ORIGIN} (scheme, host, and port must match exactly).`,
    );
  }
  return url;
}

/**
 * RFC 6265 §5.4 domain matching: a leading-dot domain covers the bare host and
 * its subdomains; a bare domain is host-only and covers exactly that host.
 *
 * @param {unknown} domain cookie domain from CDP
 * @param {unknown} host request hostname
 * @returns {boolean}
 */
export function cookieDomainApplies(domain, host) {
  const cookieDomain = String(domain ?? "").toLowerCase().replace(/\.+$/, "");
  const requestHost = String(host ?? "").toLowerCase().replace(/\.+$/, "");
  if (cookieDomain === "" || requestHost === "") return false;
  if (!cookieDomain.startsWith(".")) return requestHost === cookieDomain;
  const bare = cookieDomain.slice(1);
  return requestHost === bare || requestHost.endsWith(`.${bare}`);
}

/**
 * Host-only means the bare host with no leading dot — the shape
 * `Network.setCookie({ url })` produces.
 *
 * @param {{ domain?: string }} cookie CDP cookie
 * @param {string} host request hostname
 * @returns {boolean}
 */
export function isHostOnlyCookieFor(cookie, host) {
  const domain = String(cookie?.domain ?? "");
  if (domain === "" || domain.startsWith(".")) return false;
  return domain.toLowerCase().replace(/\.+$/, "") === String(host).toLowerCase();
}

/**
 * The one accepted shape: host-only at path `/`, the only path that covers
 * every staging request.
 *
 * @param {{ domain?: string, path?: string }} cookie CDP cookie
 * @param {string} host request hostname
 * @returns {boolean}
 */
export function isCanonicalAccessCookie(cookie, host) {
  return isHostOnlyCookieFor(cookie, host) && (cookie.path ?? "/") === "/";
}

/**
 * Every `CF_Authorization` that would reach `host` without being canonical:
 * parent-domain and dotted-host cookies, plus same-name cookies on another
 * path. Host-only cookies for OTHER hosts are left alone — Chromium never sends
 * them here.
 *
 * @param {Array<{ name?: string, domain?: string, path?: string }> | undefined} cookies `Network.getAllCookies` result
 * @param {string} host request hostname
 * @returns {Array<{ name: string, domain: string, path?: string }>}
 */
export function shadowingAccessCookies(cookies, host) {
  const out = [];
  for (const cookie of Array.isArray(cookies) ? cookies : []) {
    if (cookie?.name !== ACCESS_COOKIE_NAME) continue;
    if (!cookieDomainApplies(cookie.domain, host)) continue;
    if (isCanonicalAccessCookie(cookie, host)) continue;
    out.push(cookie);
  }
  return out;
}

/**
 * Assert the jar holds exactly one canonical cookie for `host`. Reports count,
 * domains, and paths — never a value.
 *
 * @param {Array<{ name?: string, domain?: string, path?: string }>} cookies cookies from the jar
 * @param {string} host request hostname
 */
export function assertSingleHostOnlyAccessCookie(cookies, host) {
  const applicable = (Array.isArray(cookies) ? cookies : []).filter(
    (cookie) => cookie?.name === ACCESS_COOKIE_NAME && cookieDomainApplies(cookie.domain, host),
  );
  if (applicable.length === 1 && isCanonicalAccessCookie(applicable[0], host)) return;
  const domains = applicable.map((cookie) => String(cookie.domain));
  const paths = applicable.map((cookie) => String(cookie.path ?? "/"));
  throw new Error(
    `env-failure:access-cookie-shadowed — expected exactly one host-only ${ACCESS_COOKIE_NAME} at path / for ${host}, ` +
      `found ${applicable.length}` +
      (applicable.length > 0 ? ` (domains: ${domains.join(", ")}; paths: ${paths.join(", ")})` : "") +
      ".",
  );
}

/**
 * Read the `CF_Authorization` value from a bootstrap response's `Set-Cookie`
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
 * Access application rejected the token and the run must stop.
 *
 * The probe presents its own client identity (the fetch implementation's
 * default user agent) and never impersonates a browser to pass the staging bot
 * layer. A challenge response stops the round with
 * `env-failure:access-probe-blocked`; the caller records the blocked access and
 * ends the round.
 *
 * @param {string} stagingUrl Access-protected HTTPS staging URL
 * @param {{ clientId: string, clientSecret: string }} pair resolved token pair
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<string>} the cookie value (header-only; never logged)
 */
export async function fetchAccessCookie(
  stagingUrl,
  pair,
  { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {},
) {
  const url = parseStagingUrl(stagingUrl);
  const res = await fetchImpl(url.href, {
    method: "GET",
    redirect: "manual",
    headers: {
      "CF-Access-Client-Id": pair.clientId,
      "CF-Access-Client-Secret": pair.clientSecret,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const mitigated = res.headers.get("cf-mitigated");
  if ((res.status === 403 || res.status === 429 || res.status === 503) || mitigated !== null) {
    throw new Error(
      `Agent-QA Access probe blocked by a staging bot challenge ` +
        `(HTTP ${res.status}${mitigated === null ? "" : `, cf-mitigated: ${mitigated}`}) from ${url.pathname}; ` +
        "ending the round instead of impersonating a browser (env-failure:access-probe-blocked).",
    );
  }
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
 * Stamp the value host-only at path `/`. `url` (never `domain`) is what makes
 * the cookie host-only.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown> }} page ego-browser Page
 * @param {string} stagingUrl Access-protected HTTPS staging URL
 * @param {string} value cookie value
 */
export async function stampHostOnlyAccessCookie(page, stagingUrl, value) {
  const url = parseStagingUrl(stagingUrl);
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
 * Delete every non-canonical `CF_Authorization` that would reach the staging
 * host, then read the jar back and fail closed if any survived. Scoped
 * `Network.deleteCookies` only — never a profile-wide clear.
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
      `env-failure:access-cookie-shadowed — ${survivors.length} non-canonical ${ACCESS_COOKIE_NAME} cookie(s) survived deletion ` +
        `(domains: ${survivors.map((cookie) => cookie.domain).join(", ")}).`,
    );
  }
  return doomed.map((cookie) => String(cookie.domain));
}

/**
 * Assert the jar's single-cookie invariant. Safe to call before every journey.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown> }} page ego-browser Page
 * @param {string} stagingUrl Access-protected HTTPS staging URL
 * @returns {Promise<number>} number of applicable `CF_Authorization` cookies (always 1)
 */
export async function verifySingleAccessCookie(page, stagingUrl) {
  const url = parseStagingUrl(stagingUrl);
  const { cookies } = await page.cdp("Network.getAllCookies");
  assertSingleHostOnlyAccessCookie(cookies, url.hostname);
  return (cookies ?? []).filter(
    (cookie) => cookie?.name === ACCESS_COOKIE_NAME && cookieDomainApplies(cookie.domain, url.hostname),
  ).length;
}

/**
 * Full bootstrap: purge shadows → fetch with the token pair → stamp host-only →
 * verify. Call once per round, before the first `goto()`. The fetch presents
 * the probe's own client identity; a bot challenge throws
 * `env-failure:access-probe-blocked` and ends the round.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown> }} page ego-browser Page
 * @param {{ stagingUrl: string, pair: { clientId: string, clientSecret: string }, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ purgedDomains: string[] }>}
 */
export async function ensureSingleAccessCookie(page, { stagingUrl, pair, fetchImpl }) {
  const url = parseStagingUrl(stagingUrl);
  const purgedDomains = await purgeShadowingAccessCookies(page, url.hostname);
  const value = await fetchAccessCookie(stagingUrl, pair, { fetchImpl });
  await stampHostOnlyAccessCookie(page, stagingUrl, value);
  await verifySingleAccessCookie(page, stagingUrl);
  return { purgedDomains };
}
