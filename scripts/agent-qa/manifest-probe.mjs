/**
 * Agent-QA manifest response probe (BRAWUKA-1047).
 *
 * The 2026-11-28 scheduled round stopped before the first journey because two
 * `GET /manifest.webmanifest` requests had no matching HTTP status: the runner
 * looked for `Network.responseReceived` on the manifest request and found none.
 * Chromium reports a redirect on the NEXT `Network.requestWillBeSent` of the
 * same requestId (`redirectResponse.status` + `Location`), and the Access login
 * page that follows is a different URL — so a 302 manifest fetch never produces
 * a `responseReceived` for `/manifest.webmanifest`.
 *
 * The manifest fetch is also uncredentialed by design (Chromium omits cookies,
 * and this ego-browser build rejects `Manifest` in `Fetch.enable`), so staging
 * answers 302 to the Access login page. That redirect is accepted ONLY when the
 * browser observed the manifest's own status and the destination origin equals
 * the configured Access login origin (`accessLoginOrigin`, the JWT issuer the
 * cookie bootstrap returns) at `/cdn-cgi/access/login/<staging host>`; the
 * destination is reported with its query removed. A 200 counts only for the
 * manifest URL with `application/manifest+json`. Anything else — 4xx/5xx, a
 * redirect elsewhere, HTML at the manifest URL, no observed response — stops
 * the round with `env-failure:manifest-response-unverified`.
 *
 * Usage in an ego-browser Node script, after `ensureSingleAccessCookie` and
 * before the Access request pump (both consume `page.events()`):
 *
 * ```js
 * const { captureManifestResponse } = await import(
 *   "/abs/repo/scripts/agent-qa/manifest-probe.mjs"
 * );
 * const { accessLoginOrigin } = await ensureSingleAccessCookie(page, {
 *   stagingUrl: "https://<staging host>/api/health",
 *   pair,
 * });
 * const verdict = await captureManifestResponse(page, {
 *   stagingUrl: "https://<staging host>/api/health",
 *   accessLoginOrigin,
 * });
 * console.log(verdict); // { accepted: true, outcome: "access-redirect", status: 302, ... }
 * ```
 *
 * A null `accessLoginOrigin` (opaque token) fails closed; it cannot pin the
 * login page.
 *
 * The pure helpers accept raw CDP events, so a runner that already drained
 * `page.events()` can classify them without repeating the navigation.
 */

import { parseStagingUrl } from "./access-cookie.mjs";

/** Manifest path every staging document requests. */
export const MANIFEST_PATH = "/manifest.webmanifest";

/** Content type Next.js serves for the manifest metadata route. */
export const MANIFEST_CONTENT_TYPE = "application/manifest+json";

/** Run-log signature for a manifest whose response the browser did not verify. */
export const MANIFEST_UNVERIFIED_SIGNATURE = "env-failure:manifest-response-unverified";

/** Access login path prefix: `.../cdn-cgi/access/login/<staging host>`. */
const ACCESS_LOGIN_PATH_PREFIX = "/cdn-cgi/access/login/";

/**
 * @typedef {object} ManifestRequest
 * @property {string} requestId CDP request id (stable across redirect hops)
 * @property {string | null} type CDP resource type of the manifest request
 * @property {number | null} status HTTP status of a non-redirect manifest response
 * @property {string | null} contentType `content-type` of a non-redirect response
 * @property {number | null} redirectStatus HTTP status of the manifest's redirect
 * @property {string | null} redirectLocation raw `Location` header of that redirect
 * @property {string | null} failure CDP loading error while still on the manifest URL
 */

/**
 * @typedef {object} ManifestVerdict
 * @property {boolean} accepted
 * @property {"manifest" | "access-redirect" | null} outcome
 * @property {number | null} status
 * @property {string} manifestUrl
 * @property {string | null} contentType
 * @property {string | null} accessLoginUrl query-less Access login destination
 * @property {number} requestCount
 * @property {Array<{ status: number | null, destination: string | null, failure: string | null, contentType: string | null }>} observed
 */

/**
 * Read a header case-insensitively; CDP lowercases names but fixtures and
 * future builds may not.
 *
 * @param {Record<string, unknown> | undefined} headers
 * @param {string} name
 * @returns {string | null}
 */
function readHeader(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value;
  }
  return null;
}

/**
 * Resolve a `Location` header against the URL that answered with it.
 *
 * @param {string | null} location
 * @param {string} baseUrl
 * @returns {string | null}
 */
function resolveLocation(location, baseUrl) {
  if (location === null) return null;
  try {
    return new URL(location, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Drop the query and fragment so a login destination can be logged without the
 * `redirect_url` echo.
 *
 * @param {string} value
 * @returns {string}
 */
export function stripQuery(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value).split("?")[0].split("#")[0];
  }
}

/**
 * True when `candidate` is the manifest resource on the staging origin.
 *
 * @param {string | undefined} candidate
 * @param {URL} manifestUrl
 * @returns {boolean}
 */
function isManifestResourceUrl(candidate, manifestUrl) {
  if (!candidate) return false;
  let url;
  try {
    url = new URL(String(candidate));
  } catch {
    return false;
  }
  return url.origin === manifestUrl.origin && url.pathname === manifestUrl.pathname;
}

/**
 * Require the configured Access login origin — the `iss` of the Access JWT the
 * cookie bootstrap received. Without it a 302 could point at any
 * `*.cloudflareaccess.com` tenant, so an absent or non-origin value fails
 * closed instead of widening the gate.
 *
 * @param {unknown} accessLoginOrigin
 * @returns {string} normalized `https://<team>.cloudflareaccess.com`
 */
export function normalizeAccessLoginOrigin(accessLoginOrigin) {
  let url = null;
  try {
    url = new URL(String(accessLoginOrigin));
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(
      `${MANIFEST_UNVERIFIED_SIGNATURE} — accessLoginOrigin must be the https origin of the configured Access ` +
        "login page (the `iss` origin returned by ensureSingleAccessCookie); without it the 302 destination " +
        "cannot be pinned.",
    );
  }
  return url.origin;
}

/**
 * Accept a 302 destination only when it is the CONFIGURED Access login page for
 * this staging host: origin === `accessLoginOrigin`, path
 * `/cdn-cgi/access/login/<staging host>`. The query (`redirect_url` and
 * friends) is never asserted and is stripped from the reported destination.
 *
 * @param {string | null} location raw `Location` header
 * @param {{ stagingUrl: string, accessLoginOrigin: unknown }} opts
 * @returns {{ loginUrl: string, loginHost: string } | null}
 */
export function parseAccessLoginDestination(location, { stagingUrl, accessLoginOrigin }) {
  const loginOrigin = normalizeAccessLoginOrigin(accessLoginOrigin);
  const staging = parseStagingUrl(stagingUrl);
  const resolved = resolveLocation(location, `${staging.origin}${MANIFEST_PATH}`);
  if (resolved === null) return null;
  const url = new URL(resolved);
  if (url.protocol !== "https:" || url.origin !== loginOrigin) return null;
  const expectedPath = `${ACCESS_LOGIN_PATH_PREFIX}${staging.hostname}`;
  if (url.pathname !== expectedPath && !url.pathname.startsWith(`${expectedPath}/`)) return null;
  return { loginUrl: `${url.origin}${url.pathname}`, loginHost: url.hostname };
}

/**
 * The manifest metadata route serves `application/manifest+json` (Next.js
 * `app/manifest.ts`); parameters such as `; charset=utf-8` are tolerated. A 200
 * with any other type — HTML in particular — is not the manifest.
 *
 * @param {string | null} contentType
 * @returns {boolean}
 */
function isManifestContentType(contentType) {
  return /^application\/manifest\+json(?:\s*;|$)/i.test(String(contentType ?? "").trim());
}

/**
 * Correlate raw CDP `Network.*` events into one record per manifest request.
 * The FIRST manifest hop is authoritative: a redirect is attributed to the
 * stage that answered (never to the login page that follows), and a later 200
 * after that redirect — including a return to the manifest URL — cannot rescue
 * an unapproved destination.
 *
 * @param {Array<{ method?: string, params?: any }> | undefined} events
 * @param {{ manifestUrl: string }} opts
 * @returns {{ manifestUrl: string, requests: ManifestRequest[] }}
 */
export function summarizeManifestEvidence(events, { manifestUrl }) {
  const manifest = new URL(manifestUrl);
  /** @type {Map<string, ManifestRequest>} */
  const requests = new Map();
  /** @type {Map<string, string>} */
  const previousUrl = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const params = event?.params ?? {};
    const requestId = String(params.requestId ?? "");
    if (requestId === "") continue;

    if (event?.method === "Network.requestWillBeSent") {
      const requestUrl = String(params.request?.url ?? "");
      if (isManifestResourceUrl(requestUrl, manifest)) {
        if (!requests.has(requestId)) {
          requests.set(requestId, {
            requestId,
            type: params.type ?? null,
            status: null,
            contentType: null,
            redirectStatus: null,
            redirectLocation: null,
            failure: null,
          });
        }
        previousUrl.set(requestId, requestUrl);
      }
      const record = requests.get(requestId);
      if (record && params.redirectResponse && record.redirectStatus === null && record.status === null) {
        const source = previousUrl.get(requestId) ?? String(params.redirectResponse.url ?? "");
        if (isManifestResourceUrl(source, manifest)) {
          record.redirectStatus = typeof params.redirectResponse.status === "number" ? params.redirectResponse.status : null;
          record.redirectLocation = readHeader(params.redirectResponse.headers, "location");
        }
      }
      if (requestUrl !== "" && requests.has(requestId) && !isManifestResourceUrl(requestUrl, manifest)) {
        previousUrl.set(requestId, requestUrl);
      }
      continue;
    }

    const record = requests.get(requestId);
    if (!record) continue;

    if (event?.method === "Network.responseReceived") {
      if (isManifestResourceUrl(String(params.response?.url ?? ""), manifest) && record.redirectStatus === null) {
        record.status = typeof params.response?.status === "number" ? params.response.status : null;
        record.contentType = readHeader(params.response?.headers, "content-type");
      }
      continue;
    }

    if (event?.method === "Network.loadingFailed") {
      const last = previousUrl.get(requestId) ?? "";
      if (isManifestResourceUrl(last, manifest) && record.failure === null && record.redirectStatus === null) {
        record.failure = String(params.errorText ?? "unknown network error");
      }
    }
  }

  return { manifestUrl: manifest.href, requests: [...requests.values()] };
}

/**
 * Turn correlated evidence into a verdict. A 200 for the manifest URL carrying
 * `application/manifest+json` is content; a 302 whose destination is the
 * CONFIGURED Access login page is the expected redirect; a redirect is
 * classified before a response so the first hop stays authoritative. Every
 * other terminal shape is observed but rejected.
 *
 * @param {{ manifestUrl: string, requests: ManifestRequest[] }} evidence
 * @param {{ stagingUrl: string, accessLoginOrigin: unknown }} opts
 * @returns {ManifestVerdict}
 */
export function classifyManifestEvidence(evidence, { stagingUrl, accessLoginOrigin }) {
  const loginOrigin = normalizeAccessLoginOrigin(accessLoginOrigin);
  const requests = Array.isArray(evidence?.requests) ? evidence.requests : [];
  /** @type {ManifestVerdict["observed"]} */
  const observed = [];
  /** @type {ManifestVerdict | null} */
  let content = null;
  /** @type {ManifestVerdict | null} */
  let redirect = null;

  for (const request of requests) {
    if (request.redirectStatus !== null) {
      const resolvedLocation = resolveLocation(request.redirectLocation, evidence.manifestUrl);
      const login = parseAccessLoginDestination(request.redirectLocation, { stagingUrl, accessLoginOrigin: loginOrigin });
      if (request.redirectStatus === 302 && login) {
        redirect ??= {
          accepted: true,
          outcome: "access-redirect",
          status: 302,
          manifestUrl: evidence.manifestUrl,
          contentType: null,
          accessLoginUrl: login.loginUrl,
          requestCount: requests.length,
          observed: [],
        };
      }
      observed.push({
        status: request.redirectStatus,
        destination: resolvedLocation === null ? null : stripQuery(resolvedLocation),
        failure: null,
        contentType: null,
      });
      continue;
    }
    if (request.status !== null) {
      if (request.status === 200 && isManifestContentType(request.contentType)) {
        content ??= {
          accepted: true,
          outcome: "manifest",
          status: 200,
          manifestUrl: evidence.manifestUrl,
          contentType: request.contentType,
          accessLoginUrl: null,
          requestCount: requests.length,
          observed: [],
        };
      }
      observed.push({
        status: request.status,
        destination: null,
        failure: null,
        contentType: request.contentType,
      });
      continue;
    }
    if (request.failure !== null) {
      observed.push({ status: null, destination: null, failure: request.failure, contentType: null });
      continue;
    }
    observed.push({ status: null, destination: null, failure: null, contentType: null });
  }

  const accepted = content ?? redirect;
  if (accepted) return accepted;
  return {
    accepted: false,
    outcome: null,
    status: null,
    manifestUrl: evidence.manifestUrl,
    contentType: null,
    accessLoginUrl: null,
    requestCount: requests.length,
    observed,
  };
}

/**
 * Human-readable, query-less summary for the failure message and the run log.
 *
 * @param {ManifestVerdict} verdict
 * @returns {string}
 */
export function describeManifestVerdict(verdict) {
  if (verdict.accepted) {
    if (verdict.outcome === "access-redirect") {
      return `HTTP 302 to the Access login page ${verdict.accessLoginUrl}`;
    }
    return `HTTP 200${verdict.contentType ? ` (${verdict.contentType})` : ""}`;
  }
  if (verdict.requestCount === 0) return `no GET ${MANIFEST_PATH} in the CDP network stream`;
  const parts = verdict.observed.map((entry) => {
    if (entry.failure) return `network failure ${entry.failure}`;
    if (entry.destination) return `HTTP ${entry.status} -> ${entry.destination}`;
    if (entry.status === null) return "no HTTP response";
    return `HTTP ${entry.status}${entry.contentType ? ` (${entry.contentType})` : ""}`;
  });
  return parts.join("; ");
}

/**
 * Navigate `/`, read the CDP network stream, and require browser evidence of an
 * accepted manifest response. `accessLoginOrigin` comes from
 * `ensureSingleAccessCookie` (the Access JWT `iss`); without it the 302
 * destination cannot be pinned, so the call fails closed before touching the
 * browser. Navigates after draining any buffered events, so the observed
 * manifest request belongs to this call; it must run before the Access request
 * pump starts, because `page.events()` is the only drain and both consumers
 * cannot share it.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown>, events: () => Promise<any[]>, goto: (url: string, opts?: unknown) => Promise<unknown>, waitForTimeout: (ms: number) => Promise<unknown> }} page
 * @param {{ stagingUrl: string, accessLoginOrigin: unknown, timeoutMs?: number, pollMs?: number }} opts
 * @returns {Promise<ManifestVerdict>}
 */
export async function captureManifestResponse(
  page,
  { stagingUrl, accessLoginOrigin, timeoutMs = 10_000, pollMs = 100 },
) {
  const staging = parseStagingUrl(stagingUrl);
  const loginOrigin = normalizeAccessLoginOrigin(accessLoginOrigin);
  const manifestUrl = `${staging.origin}${MANIFEST_PATH}`;
  /** @type {any[]} */
  const collected = [];

  await page.cdp("Network.enable");
  await page.events();
  try {
    await page.goto(`${staging.origin}/`, { timeout: timeoutMs });
  } catch {
    throw new Error(
      `${MANIFEST_UNVERIFIED_SIGNATURE} — the probe could not open ${staging.origin}/ to observe GET ${manifestUrl} ` +
        `within ${timeoutMs}ms; the manifest response stayed unverified.`,
    );
  }
  const deadline = Date.now() + timeoutMs;

  /** @type {ManifestVerdict} */
  let verdict;
  for (;;) {
    collected.push(...(await page.events()));
    verdict = classifyManifestEvidence(summarizeManifestEvidence(collected, { manifestUrl }), {
      stagingUrl,
      accessLoginOrigin: loginOrigin,
    });
    if (verdict.accepted || Date.now() >= deadline) break;
    await page.waitForTimeout(pollMs);
  }

  if (!verdict.accepted) {
    throw new Error(
      `${MANIFEST_UNVERIFIED_SIGNATURE} — the browser did not verify an accepted response for GET ${manifestUrl} ` +
        `(expected HTTP 200 with ${MANIFEST_CONTENT_TYPE}, or HTTP 302 to the configured Access login page ` +
        `for ${staging.hostname}; observed ${describeManifestVerdict(verdict)}).`,
    );
  }
  return verdict;
}
