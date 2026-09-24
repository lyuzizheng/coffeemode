/**
 * Agent-QA per-origin Cloudflare Access injection (BRAWUKA-508).
 *
 * Fixes the F6 leak: `CF-Access-*` service-token headers were pushed through
 * CDP `Network.setExtraHTTPHeaders`, which attaches them to EVERY request the
 * page makes — including third-party beacons (`cloudflareinsights.com`, whose
 * CORS preflight rejects the header and breaks analytics) and map tiles
 * (`openfreemap`, which accepted the request, so the secret left our domain).
 *
 * Status (ego-browser 0.5.0.32, Chromium 152, verified end-to-end on this
 * machine 2026-09-19 against a local echo server): subresource injection
 * WORKS. A paused XHR continued via `page.cdp("Fetch.continueRequest", …)`
 * with merged headers arrives at the server carrying `CF-Access-Client-Id`
 * / `CF-Access-Client-Secret` — reproduced with the full 33-pattern set
 * (3 Access hosts × 11 `ACCESS_FETCH_RESOURCE_TYPES`). Documents never pause under
 * the patterns below, so `page.goto()` resolves in ~100ms. Two real caveats
 * (both verified):
 * (a) `page.fetch` must never target an intercepted URL — its paused event
 * carries a requestId `page.cdp()` cannot continue (`Invalid
 * InterceptionId`, request hangs). Scaffold HTTP calls use direct Node
 * fetch, so they stay off this path; in-page reads use fire-and-poll
 * (`window.__x`) rather than an awaited `page.evaluate(() => fetch(…))`,
 * which times out even when the fetch completes.
 * (b) the top-frame Document navigation carries NO Access headers — first
 * staging `page.goto()` lands on the Access handshake; the agent completes
 * it once and reuses the session cookie thereafter.
 *
 * - `Network.setExtraHTTPHeaders` is global by design — no origin scoping
 *   exists. It MUST NOT be used for `CF-Access-*` (F6: token reached
 *   `cloudflareinsights.com` beacons and `openfreemap` tiles).
 * - `buildAccessFetchPatterns` scopes `Fetch.enable` to
 *   `AGENT_QA_ACCESS_HOSTS` AND to subresource `resourceType`s
 *   (`ACCESS_FETCH_RESOURCE_TYPES` — no `Document`, only types this build
 *   accepts). A paused Document stalls the `goto()` commit waiter even after
 *   a successful continue, so Documents are excluded at the PATTERN level —
 *   skipping headers in the handler would not unstall it.
 * - `createAccessRequestPump` + `handlePausedAccessRequest` is the live
 *   attach-or-passthrough contract: Access-protected-host subresources get
 *   the token pair merged in, everything else passes through untouched, and a
 *   paused request is always continued (never left hanging). Pure helpers
 *   (`shouldAttachAccessHeaders`, `mergeAccessHeaders`, `parseAccessEnvText`)
 *   are unit-pinned alongside.
 *
 * Usage:
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

import { AGENT_QA_ACCESS_HOSTS, isAccessHost } from "./allowlist.mjs";

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
 * `Fetch.RequestPattern.resourceType` takes a single enum, so each
 * Access-protected host is emitted once per type below. `Document` is
 * deliberately ABSENT: a paused top-frame Document stalls the navigation commit
 * waiter on this ego-browser build (`Fetch.continueRequest` succeeds and the page renders,
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
 * Build `Fetch.enable` request patterns scoped to the Access-protected hosts
 * AND to subresource types. Each Access host gets one `*://host/*` pattern
 * per `ACCESS_FETCH_RESOURCE_TYPES` entry; the bare
 * `*.cloudflareaccess.com` rule becomes `*://*.cloudflareaccess.com/*`, which
 * the Fetch domain matches per-request URL. The staging Supabase host stays
 * OUT of this set (BRAWUKA-593): it is a third-party API, not behind our
 * Access application, so its requests are never paused for injection. No
 * catch-all pattern is ever emitted, and no pattern can match a Document
 * navigation — a request the patterns don't match is never paused and
 * therefore can never receive the token pair or stall navigation.
 *
 * @returns {Array<{ urlPattern: string, requestStage: string, resourceType: string }>}
 */
export function buildAccessFetchPatterns() {
  return AGENT_QA_ACCESS_HOSTS.flatMap((rule) =>
    ACCESS_FETCH_RESOURCE_TYPES.map((resourceType) => ({
      urlPattern: `*://${rule}/*`,
      requestStage: "Request",
      resourceType,
    })),
  );
}

/**
 * Decide whether a paused request URL may receive the Access token pair:
 * http(s) only, and its hostname must match `isAccessHost` — the
 * Access-protected subset, NOT the full navigation allowlist (BRAWUKA-593:
 * the staging Supabase host is navigable but must never receive the token
 * pair). Fail-closed: unparsable URLs, non-http(s) schemes, and off-scope
 * hosts all return false.
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
  return isAccessHost(url.hostname);
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
 * Handle one `Fetch.requestPaused` event: continue Access-protected-host
 * requests with the token pair merged in, pass everything else through unchanged.
 * Never throws — a paused request MUST always be continued, otherwise the
 * page hangs; on unexpected shapes it continues the request unmodified.
 *
 * Caveat (ego-browser 0.5.0.32, verified 2026-09-19): a paused event from
 * `page.fetch` against an intercepted URL carries a requestId `page.cdp()`
 * cannot continue (`Invalid InterceptionId`, request hangs) — never use
 * `page.fetch` for Access-protected-host URLs while `Fetch.enable` is active;
 * in-page reads use fire-and-poll instead. Pauses from real page subresources
 * (XHR/fetch from page JS, images, favicon) continue normally.
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
 * `page.fetch` must never target an intercepted URL (see
 * `handlePausedAccessRequest` caveat — it hangs the same way); scaffold HTTP
 * calls use direct Node fetch, so they stay off this path.
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
