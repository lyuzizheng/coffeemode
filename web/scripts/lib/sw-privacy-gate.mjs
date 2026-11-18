/**
 * Service Worker privacy & network-only rules gate (BRAWUKA-706).
 *
 * Covers T23 and is the executable contract for `web/lib/sw-rules.ts`
 * (`RUNTIME_RULES`; no unit test pins it):
 *   - Proves SW rules are network-only for private routes:
 *     `/`, `/auth/*`, `/cafes/*`, `/api/*`, `/profile*`, `/settings*`, `/search*`
 *   - Exercises the request classes the pathname matchers must cover: document
 *     navigations, the App Router RSC fetch, its prefetch variant, and an API
 *     GET — all through the real active worker.
 *   - Browser assertion: after those requests, `caches.keys()` across all
 *     Cache Storage caches contains zero entries matching these private paths,
 *     polled across a 3 s settle window so an asynchronous worker write cannot
 *     land after the gate has already passed.
 */
import { assert, shot } from "./gate-assert.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

const PRIVATE_PREFIXES = ["/auth", "/cafes", "/api", "/profile", "/settings", "/search"];

/**
 * Serwist hands the response to the page BEFORE its cache write lands:
 * `StrategyHandler.fetchAndCachePut` calls `waitUntil(cachePut(...))` and
 * returns the response un-awaited. A single post-response scan therefore
 * passes while a fall-through handler is still writing (review P1: a
 * 1,500 ms delayed `Cache.put` was found only by a second scan). Observe the
 * real Cache Storage across a settle window and fail on the first private
 * entry; 3 s is twice the delay that reproduced the defect.
 */
const CACHE_SETTLE_MS = 3000;
const CACHE_POLL_INTERVAL_MS = 100;

/**
 * `defaultCache` buckets these two shapes into 24h NetworkFirst caches
 * (`pages-rsc` / `pages-rsc-prefetch`) keyed on the headers, so a deleted
 * `/cafes/*` rule shows up as a cache entry rather than a silent fall-through.
 * Query values are gate-scoped so the route below can serve them locally.
 */
const RSC_PROBES = [
  { label: "RSC", headers: { RSC: "1" }, query: "_rsc=sw-gate" },
  {
    label: "RSC prefetch",
    headers: { RSC: "1", "Next-Router-Prefetch": "1" },
    query: "_rsc=sw-gate-prefetch",
  },
];

async function readCacheEntries(page) {
  return page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const urls = [];
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const reqs = await cache.keys();
      for (const req of reqs) {
        urls.push({ cache: name, url: req.url });
      }
    }
    return urls;
  });
}

/** One cache snapshot: reject the root document and every private route. */
function assertSnapshotClean(cachedUrls) {
  for (const entry of cachedUrls) {
    const { pathname } = new URL(entry.url);

    // Root document must never be cached
    if (pathname === "/") {
      throw new Error(`Cache "${entry.cache}" contains root document: ${entry.url}`);
    }

    // Private routes must never be cached
    for (const prefix of PRIVATE_PREFIXES) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        throw new Error(`Cache "${entry.cache}" contains private path ${pathname} (${entry.url})`);
      }
    }
  }
}

/**
 * Poll the live Cache Storage until the settle window closes, failing on the
 * first private entry. Polling (not one read at the end) matters: a late write
 * and a later eviction must not average out to a clean final snapshot.
 */
async function assertNoPrivateDocuments(page) {
  const deadline = Date.now() + CACHE_SETTLE_MS;
  for (;;) {
    assertSnapshotClean(await readCacheEntries(page));
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await page.waitForTimeout(Math.min(CACHE_POLL_INTERVAL_MS, remaining));
  }
}

/**
 * Serve the RSC probe responses locally. Next canonicalizes any made-up
 * `_rsc` value with a 307, and the production CSP (`upgrade-insecure-requests`)
 * makes the browser retry that hop over https against an http server, so the
 * probe would die with ERR_FAILED before a cache decision is observable. The
 * cache decision itself — path matcher, strategy, Cache Storage write — stays
 * entirely inside the real worker; only the RSC payload is stubbed.
 */
async function routeRscProbes(context) {
  await context.route(/_rsc=sw-gate/, (route) =>
    route.fulfill({ status: 200, contentType: "text/x-component", body: "" }),
  );
}

/**
 * Wait until the worker is active AND controlling: an active-but-uncontrolled
 * page never routes a fetch through the worker, so every Cache Storage
 * assertion would pass vacuously.
 */
async function assertControlling(page) {
  const controlling = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("no controllerchange within 5s")), 5000);
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
    return Boolean(navigator.serviceWorker.controller);
  });
  assert(controlling, "Page is not controlled by the service worker; cache assertions would be vacuous");
}

/** Issue the RSC / prefetch fetches the path matcher must cover. A non-200
 *  answer would not prove the route rule, so the status is part of the proof. */
async function probeRscRequests(page, cafeId) {
  for (const probe of RSC_PROBES) {
    const status = await page.evaluate(
      async ({ path, headers }) => (await fetch(path, { headers })).status,
      { path: `/cafes/${cafeId}?${probe.query}`, headers: probe.headers },
    );
    assert(
      status === 200,
      `${probe.label} probe for /cafes/${cafeId} answered ${status}; a non-200 response does not prove the route rule`,
    );
  }
}

/**
 * @param {object} options
 * @param {string} options.label
 * @param {string} options.base
 * @param {string} options.cafeId
 * @param {Function} options.createContext
 * @param {Function} options.attachErrorCollector
 */
export async function runSwPrivacyGate({
  label,
  base,
  cafeId,
  createContext,
  attachErrorCollector,
}) {
  clearGateArtifacts("sw-privacy");

  await withGateContext("sw-privacy", createContext, {}, async (context, consoleLines) => {
    await routeRscProbes(context);
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 }, consoleLines);

    // Initial navigation to register and activate the service worker
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await assertControlling(page);

    // Visit private routes covered by network-only rules. /auth/callback is
    // the only GET handler under /auth/ (OAuth redirect target): hitting it
    // without a code 307s to /?auth=error, which still routes the /auth/
    // request through the active worker so the prefix rule is exercised.
    const routesToVisit = [
      "/",
      "/auth/callback",
      `/cafes/${cafeId}`,
      "/profile",
      "/settings",
      "/search",
    ];

    for (const route of routesToVisit) {
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
    }

    // Direct fetch to API route under active SW
    await page.evaluate(async (origin) => {
      await fetch(`${origin}/api/health`).catch(() => {});
    }, base);

    // The /cafes/* rule matches on pathname, so it must cover the request
    // classes the document navigation above does not produce: the App Router
    // RSC fetch and its prefetch variant. Without that rule those land in the
    // 24h "pages-rsc"/"pages-rsc-prefetch" buckets and the scan below fails.
    await probeRscRequests(page, cafeId);

    await assertNoPrivateDocuments(page);

    await shot(page, "sw-privacy", "sw-active");
    checkErrors();
    return page;
  }, label);
}
