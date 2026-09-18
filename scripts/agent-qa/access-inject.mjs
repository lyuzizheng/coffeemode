/**
 * Agent-QA per-origin Cloudflare Access injection (BRAWUKA-508).
 *
 * Fixes the F6 leak: `CF-Access-*` service-token headers were pushed through
 * CDP `Network.setExtraHTTPHeaders`, which attaches them to EVERY request the
 * page makes — including third-party beacons (`cloudflareinsights.com`, whose
 * CORS preflight rejects the header and breaks analytics) and map tiles
 * (`openfreemap`, which accepted the request, so the secret left our domain).
 *
 * Status (ego-browser 0.5.0.32, Chromium 152, verified on this machine
 * 2026-09-19): the scope below is CORRECT but NOT YET USABLE — `Fetch.enable`
 * itself is proven (patterns accepted, Documents excluded so `page.goto()`
 * resolves in ~100ms, zero Document pauses buffered), but `Fetch.continue*`
 * issued through `page.cdp()` returns `Invalid InterceptionId` for every
 * paused subresource (XHR, Image incl. `new Image()` tags) and the request
 * hangs until its own timeout. Same failure for `fulfillRequest`,
 * `failRequest`, `continueWithAuth`; `task.cdp()` accepts only
 * Target/Browser commands; `Fetch.disable` does not release paused requests.
 * The interception belongs to an internal CDP session the command channel
 * cannot continue. Until that ownership is fixed: do NOT `Fetch.enable` on a
 * journey page. Per-origin injection stays open, blocked on ego-browser;
 * the global `Network.setExtraHTTPHeaders` path stays retired regardless.
 *
 * - `Network.setExtraHTTPHeaders` is global by design — no origin scoping
 *   exists. It MUST NOT be used for `CF-Access-*` (F6: token reached
 *   `cloudflareinsights.com` beacons and `openfreemap` tiles).
 * - `buildAccessFetchPatterns` scopes `Fetch.enable` to
 *   `AGENT_QA_ALLOWED_HOSTS` AND to subresource `resourceType`s
 *   (`ACCESS_FETCH_RESOURCE_TYPES` — no `Document`, only types this build
 *   accepts). A paused Document stalls the `goto()` commit waiter even after
 *   a successful continue, so Documents are excluded at the PATTERN level —
 *   skipping headers in the handler would not unstall it.
 * - `createAccessRequestPump` + `handlePausedAccessRequest` is the correct
 *   attach-or-passthrough contract for when continuation works. Pure
 *   functions (`shouldAttachAccessHeaders`, `mergeAccessHeaders`,
 *   `parseAccessEnvText`) are live and unit-pinned; the CDP round-trip is
 *   the blocked part.
 * - Safe operating point today: no `Fetch.enable` during the journey, so the
 *   first staging `page.goto()` is unauthenticated and lands on the Access
 *   handshake; the agent completes it once and reuses the session cookie.
 *   Scaffold HTTP calls use direct Node fetch (never `page.fetch` against an
 *   intercepted URL — it hangs the same way), so they are off this path.
 *
 * Usage (enable ONLY after the ego-browser interception fix lands):
 *
 * ```js
 * import {
 *   buildAccessFetchPatterns,
 *   createAccessRequestPump,
 *   resolveAccessHeaders,
 * } from "./access-inject.mjs";
 *
 * const pair = resolveAccessHeaders(); // fail-closed when env is unset
 * const pump = createAccessRequestPump(pair);
 * await page.cdp("Fetch.enable", {
 *   patterns: buildAccessFetchPatterns(),
 * });
 * const stop = pump.start(page); // drain page.events(), merge headers
 * try {
 *   await page.goto("https://staging.cafemood.app/discover");
 *   // ... agent journey ...
 * } finally {
 *   stop();
 *   await page.cdp("Fetch.disable", {});
 * }
 * ```
 *
 * Secret-bridge contract (F8): the ego-browser Node process does NOT inherit
 * the agent's env, so `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` must
 * be bridged explicitly. The supported bridge is a `0600` temporary file
 * holding `KEY=VALUE` lines, read at scaffold start and deleted immediately
 * after (`loadAccessEnvFile`). Secrets never enter the transcript, a prompt,
 * or the client bundle.
 */

import {
  ACCESS_CLIENT_ID_ENV,
  ACCESS_CLIENT_SECRET_ENV,
  ACCESS_CLIENT_ID_HEADER,
  ACCESS_CLIENT_SECRET_HEADER,
  resolveAccessHeaders,
} from "./access-headers.mjs";
import { AGENT_QA_ALLOWED_HOSTS, isAllowedHost } from "./allowlist.mjs";

/**
 * Subresource `Network.ResourceType` values stamped by
 * `buildAccessFetchPatterns` — a subset of the CDP enum that EXCLUDES
 * `Document` and that this ego-browser build accepts in
 * `Fetch.RequestPattern.resourceType` (enumerated live: `TextTrack`,
 * `Prefetch`, `WebSocket`, `Manifest`, `SignedExchange`, `Preflight`, and
 * `FedCM` are rejected as "Unknown resource type in fetch filter" and are
 * therefore omitted — requests of those types simply never pause:
 * fail-closed on both leak and stall).
 *
 * `Fetch.RequestPattern.resourceType` takes a single enum, so each allowlist
 * host is emitted once per type below. `Document` is deliberately ABSENT: a
 * paused top-frame Document stalls the navigation commit waiter on this
 * ego-browser build (`Fetch.continueRequest` succeeds and the page renders,
 * but `page.goto()` never resolves — verified). Skipping headers for
 * Documents in the handler would NOT fix that; only never pausing them does.
 */
export const ACCESS_FETCH_RESOURCE_TYPES = Object.freeze([
  "Stylesheet",
  "Image",
  "Media",
  "Font",
  "Script",
  "XHR",
  "Fetch",
  "EventSource",
  "Ping",
  "CSPViolationReport",
  "Other",
]);

/**
 * Build `Fetch.enable` request patterns scoped to the staging allowlist AND
 * to subresource types. Each allowlisted host gets one `*://host/*` pattern
 * per `ACCESS_FETCH_RESOURCE_TYPES` entry; the bare
 * `*.cloudflareaccess.com` rule becomes `*://*.cloudflareaccess.com/*`, which
 * the Fetch domain matches per-request URL. No catch-all pattern is ever
 * emitted, and no pattern can match a Document navigation — a request the
 * patterns don't match is never paused and therefore can never receive the
 * token pair or stall navigation.
 *
 * @returns {Array<{ urlPattern: string, requestStage: string, resourceType: string }>}
 */
export function buildAccessFetchPatterns() {
  return AGENT_QA_ALLOWED_HOSTS.flatMap((rule) =>
    ACCESS_FETCH_RESOURCE_TYPES.map((resourceType) => ({
      urlPattern: `*://${rule}/*`,
      requestStage: "Request",
      resourceType,
    })),
  );
}

/**
 * Decide whether a paused request URL may receive the Access token pair:
 * http(s) only, and its hostname must match `isAllowedHost` (the same
 * predicate that gates navigation). Fail-closed: unparsable URLs,
 * non-http(s) schemes, and off-allowlist hosts all return false.
 *
 * @param {unknown} requestUrl absolute request URL from `Fetch.requestPaused`
 * @returns {boolean} true only when the headers may be attached
 */
export function shouldAttachAccessHeaders(requestUrl) {
  let url;
  try {
    url = new URL(String(requestUrl));
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return isAllowedHost(url.hostname);
}

/**
 * Merge the Access token pair into paused-request headers WITHOUT mutating
 * the input. `Fetch.requestPaused` delivers headers as an object; CDP
 * `Fetch.continueRequest` wants an array of `{ name, value }`. Existing
 * values for the two `CF-Access-*` names are replaced (case-insensitive);
 * every other header passes through untouched, in order.
 *
 * @param {Record<string, string | string[]> | undefined} original headers from the paused request
 * @param {{ clientId: string, clientSecret: string }} pair resolved token pair
 * @returns {Array<{ name: string, value: string }>} headers for `Fetch.continueRequest`
 */
export function mergeAccessHeaders(original, { clientId, clientSecret }) {
  const merged = [];
  const seen = new Set([
    ACCESS_CLIENT_ID_HEADER.toLowerCase(),
    ACCESS_CLIENT_SECRET_HEADER.toLowerCase(),
  ]);
  if (original && typeof original === "object") {
    for (const [name, value] of Object.entries(original)) {
      if (seen.has(String(name).toLowerCase())) continue;
      merged.push({ name: String(name), value: Array.isArray(value) ? value.join(", ") : String(value) });
    }
  }
  merged.push({ name: ACCESS_CLIENT_ID_HEADER, value: clientId });
  merged.push({ name: ACCESS_CLIENT_SECRET_HEADER, value: clientSecret });
  return merged;
}

/**
 * Handle one `Fetch.requestPaused` event: continue allowlisted requests with
 * the token pair merged in, pass everything else through unchanged.
 * Never throws — a paused request MUST always be continued, otherwise the
 * page hangs; on unexpected shapes it continues the request unmodified.
 *
 * LIMITATION (ego-browser 0.5.0.32, verified 2026-09-19): `continueRequest`
 * through `page.cdp()` returns `Invalid InterceptionId` for paused
 * subresources — the interception belongs to an internal CDP session the
 * command channel cannot continue (same for `fulfillRequest`, `failRequest`,
 * `continueWithAuth`). The handler stays the correct attach-or-passthrough
 * contract for when the ownership is fixed; today a matched subresource
 * hangs until its own timeout, so do NOT `Fetch.enable` on a journey page.
 *
 * @param {{ cdp: (method: string, params?: unknown) => Promise<unknown> }} page ego-browser Page (or any `{ cdp }` handle)
 * @param {{ method?: string, params?: { requestId?: string, request?: { url?: string, headers?: Record<string, string> } } }} event one buffered CDP event
 * @param {{ clientId: string, clientSecret: string }} pair resolved token pair
 * @returns {Promise<"attached" | "passthrough">} which path was taken
 */
export async function handlePausedAccessRequest(page, event, pair) {
  const requestId = event?.params?.requestId;
  const request = event?.params?.request;
  const headers = shouldAttachAccessHeaders(request?.url)
    ? mergeAccessHeaders(request?.headers, pair)
    : undefined;
  if (typeof requestId === "string" && requestId !== "") {
    try {
      await page.cdp(
        "Fetch.continueRequest",
        headers ? { requestId, headers } : { requestId },
      );
    } catch {
      /* best-effort: the browser already settled this interception */
    }
  }
  return headers ? "attached" : "passthrough";
}

/**
 * Create a drain pump for the ego-browser `page.events()` buffer. The pump
 * polls the buffer and routes each `Fetch.requestPaused` event through
 * `handlePausedAccessRequest`.
 *
 * While the `handlePausedAccessRequest` LIMITATION above holds, enabling
 * Fetch interception on a journey page breaks subresource loading (a matched
 * subresource never loads; `Fetch.disable` does not release paused
 * requests). Safe operating point today: NO `Fetch.enable` during the
 * journey — Documents and subresources alike load normally — and the global
 * `Network.setExtraHTTPHeaders` path stays retired regardless (F6).
 * `page.fetch` against an intercepted URL hangs for the same reason; scaffold
 * HTTP calls use direct Node fetch, so this is off the hot path.
 *
 * @param {{ clientId: string, clientSecret: string }} pair resolved token pair
 * @param {{ intervalMs?: number }} [opts] poll interval (default 25ms)
 * @returns {{ start: (page: { events: () => Promise<Array<unknown>>, cdp: (method: string, params?: unknown) => Promise<unknown> }) => () => void }}
 */
export function createAccessRequestPump(pair, { intervalMs = 25 } = {}) {
  return {
    start(page) {
      let stopped = false;
      const timer = setInterval(() => {
        if (stopped) return;
        page
          .events()
          .then(async (events) => {
            if (stopped || !Array.isArray(events)) return;
            for (const event of events) {
              if (stopped) return;
              if (event?.method !== "Fetch.requestPaused") continue;
              await handlePausedAccessRequest(page, event, pair);
            }
          })
          .catch(() => {
            /* best-effort: buffer reads must never break the journey */
          });
      }, intervalMs);
      if (typeof timer.unref === "function") timer.unref();
      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
  };
}

const ACCESS_ENV_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/**
 * Parse `KEY=VALUE` lines (blank lines and `#` comments skipped, single or
 * double quotes stripped) into the subset the Access bridge cares about.
 *
 * @param {unknown} text file content
 * @returns {{ CF_ACCESS_CLIENT_ID?: string, CF_ACCESS_CLIENT_SECRET?: string }}
 */
export function parseAccessEnvText(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = ACCESS_ENV_LINE.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (key !== ACCESS_CLIENT_ID_ENV && key !== ACCESS_CLIENT_SECRET_ENV) continue;
    let value = raw;
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value !== "") out[key] = value;
  }
  return out;
}

/**
 * Load the Access pair from a `0600` bridge file (see module header), for
 * ego-browser Node processes that don't inherit the agent env. Reads the
 * file, deletes it immediately, then resolves fail-closed via
 * `resolveAccessHeaders` — so a missing file and missing variables both abort
 * the run before staging is touched.
 *
 * @param {string} filePath absolute path to the bridge file
 * @param {{ readFile: (path: string, encoding: string) => Promise<string>, unlink: (path: string) => Promise<void> }} [fsImpl] injectable fs (default: node:fs/promises)
 * @returns {Promise<{ clientId: string, clientSecret: string }>}
 */
export async function loadAccessEnvFile(filePath, fsImpl) {
  const fs = fsImpl ?? (await import("node:fs/promises"));
  const text = await fs.readFile(filePath, "utf8");
  try {
    await fs.unlink(filePath);
  } catch {
    /* the secret was read; a failed delete must not resend it anywhere */
  }
  return resolveAccessHeaders(parseAccessEnvText(text));
}
