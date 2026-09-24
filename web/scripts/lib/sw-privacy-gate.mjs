/**
 * Service Worker privacy & network-only rules gate (BRAWUKA-706).
 *
 * Covers T23:
 *   - Proves SW rules are network-only for private routes:
 *     `/`, `/auth/*`, `/cafes/*`, `/api/*`, `/profile*`, `/settings*`, `/search*`
 *   - Browser assertion: visits these routes with SW active, then asserts that
 *     `caches.keys()` across all Cache Storage caches contains zero documents
 *     matching these private path rules.
 */
import { assert, shot } from "./gate-assert.mjs";
import { clearGateArtifacts, withGateContext } from "./e2e-artifacts.mjs";

const PRIVATE_PREFIXES = ["/auth", "/cafes", "/api", "/profile", "/settings", "/search"];

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
    const page = await context.newPage();
    const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 }, consoleLines);

    // Initial navigation to register and activate the service worker
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });

    // Wait for the service worker registration to be active
    const swActive = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg?.active);
    });
    assert(swActive, "Service worker failed to become active");

    // Visit private routes covered by network-only rules
    const routesToVisit = [
      "/",
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

    // Inspect all entries across all Cache Storage caches
    const cachedUrls = await page.evaluate(async () => {
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

    for (const entry of cachedUrls) {
      const parsed = new URL(entry.url);
      const pathname = parsed.pathname;

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

    await shot(page, "sw-privacy", "sw-active");
    checkErrors();
    return page;
  }, label);
}
