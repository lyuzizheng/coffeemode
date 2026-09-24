#!/usr/bin/env node
/**
 * CafeMood Deterministic Playwright E2E Smoke Suite (Issue #155, refactored in #271).
 *
 * Proves core MVP journeys end-to-end against a Next.js standalone production build:
 *   1. Signed-out discovery, theme toggle, and deep links (Home, Cafe Detail, 404 Recovery).
 *   2. Static preview and offline routes (/theme-preview, /~offline).
 *   3. Signed-out profile view and search history panel (/profile).
 *   4. Core API health and mutation contract boundaries.
 *   5. Check-in drawer geometry (BRAWUKA-217, lib/checkin-drawer-gate.mjs).
 *
 * Invariants:
 *   - Fails visibly on unexpected console errors, unhandled page errors, or broken navigation.
 *   - Third-party boundaries (Apple MapKit, Google Places, Supabase OAuth, R2) are stubbed
 *     via Playwright route interception so CI is 100% deterministic and offline-resilient.
 *   - Spawns standalone Next.js server (`node .next/standalone/server.js`) with static assets.
 *   - DB-backed SSR pages use isolated, self-cleaning seeded fixtures against Postgres.
 *   - In CI (`CI=true`), database fixture setup is strictly required and fails fast if missing.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  E2E_CAFE_ID,
  E2E_USER_ID,
  setupDbFixtures,
  teardownDbFixtures,
  DEFAULT_DATABASE_URL,
} from "./lib/e2e-fixtures.mjs";
import {
  reportServerRenderErrors,
  getFreePort,
  spawnStandaloneServer,
  waitForServer,
  registerProcessCleanup,
} from "./lib/standalone-server.mjs";
import { runRegistryGates } from "./lib/e2e-gates.mjs";
import { clearArtifactsDir } from "./lib/e2e-artifacts.mjs";
import { assert } from "./lib/gate-assert.mjs";
import { stubOpenFreeMap } from "./lib/tile-stubs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

// BRAWUKA-704 (D4): `desktop` (default, 1280x800) runs the inline T1–T5
// checks plus every registry gate; `E2E_VIEWPORT=mobile` runs the inline T1–T5
// checks at the mobile viewport plus only the registry's allowlisted subset
// (auth-session, checkin-submit, search-discovery — the last two land in
// later slices). The default context viewport follows the same flag.
const E2E_VIEWPORT = process.env.E2E_VIEWPORT ?? "desktop";
if (E2E_VIEWPORT !== "desktop" && E2E_VIEWPORT !== "mobile") {
  console.error(`Unknown E2E_VIEWPORT=${JSON.stringify(E2E_VIEWPORT)} — expected "desktop" or "mobile".`);
  process.exit(1);
}

 if (!process.env.E2E_BASE_URL && !existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("No production build found in web/.next — run `npm run build` first.");
  process.exit(1);
}

let serverProcess = null;
let dbClient = null;
let browser = null;

const cleanup = async () => {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Benign: browser may have crashed or already closed during test execution.
    }
    browser = null;
  }
  if (serverProcess) {
    try {
      serverProcess.kill("SIGTERM");
    } catch {
      // Benign: server process may have already exited.
    }
    serverProcess = null;
  }
  // Fixture cleanup failures are real failures (BRAWUKA-629): a leftover row
  // pollutes the next run, so it lands in `failures` like any gate error.
  const cleanupErr = await teardownDbFixtures(dbClient);
  dbClient = null;
  if (cleanupErr) failures.push(cleanupErr.message ?? String(cleanupErr));
};

registerProcessCleanup(cleanup);

// ---------------------------------------------------------------------------
// Main E2E Test Runner
// ---------------------------------------------------------------------------
const failures = [];


async function runSmokeSuite() {
  // Stale-artifact guard: skipped gates (mobile filter, no-DB, mock-miss)
  // keep no directory from a previous run — everything starts absent.
  clearArtifactsDir();

  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : await getFreePort();
  const base = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

  const fixtureResult = await setupDbFixtures({ dbUrl, tag: "[E2E]" });
  const hasDb = fixtureResult.hasDb;
  dbClient = fixtureResult.dbClient;
  console.log(`[E2E] DB fixture initialized: ${hasDb ? "yes (Postgres)" : "no (fallback mode)"}`);
  if (!process.env.E2E_BASE_URL) {
    serverProcess = spawnStandaloneServer({
      cwd: root,
      port,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        DATABASE_URL: dbUrl,
        // T8 signs in for real: the standalone server must reach the
        // supabase-mock (compose service, :54321) for session validation.
        NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? "e2e-anon-key",
      },
    });

    serverProcess.stdout.on("data", (d) => {
      process.stdout.write(`[Next.js Server] ${d.toString()}`);
    });
    reportServerRenderErrors(serverProcess, {
      failures,
      onLine: (text) => process.stderr.write(`[Next.js Server ERROR] ${text}`),
    });
  }

  try {
    await waitForServer(base);
    console.log(`[E2E] Web server ready at ${base}`);

    browser = await chromium.launch({ headless: true });

    // -------------------------------------------------------------------------
    // Common Context Setup with 3rd-Party Mock Boundaries
    // -------------------------------------------------------------------------
    async function createContext(options = {}) {
      const context = await browser.newContext({
        // D4: the flag that filters the registry also sets the default
        // viewport, so gates on the default context (upcoming auth-session,
        // inline T1–T5) exercise the mobile layout under E2E_VIEWPORT=mobile.
        ...(E2E_VIEWPORT === "mobile"
          ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
          : { viewport: { width: 1280, height: 800 } }),
        ...options,
      });

      // Stub 3rd party networks to eliminate CI flakiness
      await context.route("**/*apple-mapkit*", (route) => route.fulfill({ status: 200, body: "" }));
      await context.route("**/*maps.googleapis.com*", (route) => route.fulfill({ status: 200, json: { status: "OK", results: [] } }));
      await context.route("**/api/mapkit-token", (route) => route.fulfill({ status: 200, json: { token: "e2e-fake-mapkit-token" } }));
      // map-home: the basemap host is stubbed offline (empty-but-valid
      // tiles/glyphs/sprites) — the map surface must never reach the network.
      await stubOpenFreeMap(context);

      return context;
    }

    function attachErrorCollector(page, label, expected = { status: 200, path: "" }, consoleSink = null) {
      const pageErrors = [];
      // Artifact capture is additive: every fault lands in `pageErrors` so
      // `checkErrors()` still fails the run; the mirror into `consoleSink`
      // only feeds the gate's `console.log` artifact.
      const push = (line) => {
        pageErrors.push(line);
        if (consoleSink) consoleSink.push(line);
      };
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        // Chromium logs the document's own non-2xx response as a console
        // error; when that status is the route's expectation (the 404
        // fixture), it is the contract, not a fault. Gated on the message
        // source being the document itself so a subresource failure with
        // the same status still fails the gate.
        if (
          expected.status >= 400 &&
          msg.location()?.url === `${base}${expected.path}` &&
          msg.text().startsWith(
            `Failed to load resource: the server responded with a status of ${expected.status} `,
          )
        ) {
          return;
        }
        if (
          expected.subresources?.some(
            (s) =>
              (!s.path || msg.location()?.url?.includes(s.path)) &&
              msg.text().startsWith(`Failed to load resource: the server responded with a status of ${s.status} `),
          )
        ) {
          return;
        }
        // DG64/DG105/DG77: signed-out, the client probes per-user endpoints
        // the CDN-cached shell can't bake in — `/api/checkins/last` on
        // drawer open, `/api/navigations/prompt` at idle. Their 401 is the
        // contract's anonymous answer (sign-in gate / no prompt), not a
        // fault. Exempt exactly those subresource errors — any other
        // endpoint's non-2xx still fails the gate.
        if (
          (msg.location()?.url?.startsWith(`${base}/api/checkins/last`) ||
            msg.location()?.url?.startsWith(`${base}/api/navigations/prompt`)) &&
          msg.text().startsWith(
            "Failed to load resource: the server responded with a status of 401 ",
          )
        ) {
          return;
        }
        push(`console.error: ${msg.text()}`);
      });
      page.on("pageerror", (err) => {
        push(`pageerror: ${err.message}`);
      });
      return () => {
        if (pageErrors.length > 0) {
          failures.push(`${label}:\n  ${pageErrors.join("\n  ")}`);
        }
      };
    }
    // -------------------------------------------------------------------------
    // Test 1: Signed-out Discovery & Home Page
    // -------------------------------------------------------------------------
    {
      const label = "T1: Map Surface & Discovery Shell (Signed-Out)";
      console.log(`[E2E] Running ${label}...`);
      const context = await createContext();
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/", status: 200 });

      const res = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      assert(res?.status() === 200, `Expected 200, got ${res?.status()}`);
      // map-home: the basemap renders as a MapLibre canvas — or, where
      // headless WebGL is unavailable, the designed error state. Either way
      // the discovery sidebar must be live (the data path is map-independent).
      const mapCanvas = page.locator("canvas.maplibregl-canvas");
      const mapError = page.getByRole("alert");
      await mapCanvas.or(mapError).first().waitFor({ state: "visible", timeout: 20000 });
      const sidebar = page.locator("aside");
      assert((await sidebar.count()) > 0, "Discovery sidebar not rendered");

      checkErrors();
      await context.close();
      console.log(`[E2E] ok ${label}`);
    }

    // -------------------------------------------------------------------------
    // Test 2: Cafe Detail Deep Link (/cafes/[id])
    // -------------------------------------------------------------------------
    if (hasDb) {
      const label = "T2: Cafe Detail SSR & Interactive Shell";
      console.log(`[E2E] Running ${label}...`);
      const context = await createContext();
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: `/cafes/${E2E_CAFE_ID}`, status: 200 });

      const res = await page.goto(`${base}/cafes/${E2E_CAFE_ID}`, { waitUntil: "domcontentloaded" });
      const bodyHtml = await page.innerHTML("body");
      assert(res?.status() === 200, `Expected 200 for seeded cafe, got ${res?.status()}`);
      // BRAWUKA-184: the plain shell is the cacheable class — the static
      // public header from the single source (app.yaml seo.shellCache).
      const cc2 = res?.headers()["cache-control"] ?? "";
      assert(
        cc2.includes("public") && cc2.includes("s-maxage=600"),
        `Expected cacheable Cache-Control on plain shell, got "${cc2}"`,
      );
      assert(bodyHtml.includes("E2E Smoke Cafe"), "Cafe name 'E2E Smoke Cafe' not rendered on page");
      assert(bodyHtml.includes("San Francisco"), "City 'San Francisco' not rendered on page");

      // Verify Share button exists and is clickable
      const shareButton = page.locator("button:has-text('Share'), button[aria-label*='Share' i], button:has-text('分享')");
      if ((await shareButton.count()) > 0) {
        await shareButton.first().click();
        await page.waitForTimeout(200);
      }
      checkErrors();
      await context.close();
      console.log(`[E2E] ok ${label}`);
    }

    // -------------------------------------------------------------------------
    // Test 3: 404 Recovery State (/cafes/definitely-not-a-cafe)
    // -------------------------------------------------------------------------
    {
      const label = "T3: 404 Recovery on Invalid Cafe Deep Link";
      console.log(`[E2E] Running ${label}...`);
      const context = await createContext();
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/cafes/definitely-not-a-cafe", status: 404 });

      const res = await page.goto(`${base}/cafes/definitely-not-a-cafe`, { waitUntil: "domcontentloaded" });
      assert(res?.status() === 404, `Expected HTTP 404 status for invalid cafe, got ${res?.status()}`);
      // BRAWUKA-658: the proxy no longer probes or rewrites gone cafes —
      // the page's generateMetadata() commits the 404 via notFound(), so the
      // response carries the static /cafes/:id* s-maxage header. Shared-cache
      // exclusion of the 404 is owned by the edge rule
      // (deploy/dokploy/cache-rules.json onStatusesOtherThan: [200]),
      // drift-pinned by tests/cafe-shell-cache.test.ts.

      const pageText = await page.textContent("body");
      assert(
        pageText?.includes("404") || pageText?.includes("Not Found") || pageText?.includes("not found") || pageText?.includes("未找到"),
        "Designed 404 message not found in body",
      );

      checkErrors();
      await context.close();
      console.log(`[E2E] ok ${label}`);
    }

    // -------------------------------------------------------------------------
    // Test 4: Static & Offline Routes (/theme-preview, /~offline)
    // -------------------------------------------------------------------------
    {
      const label = "T4: Static Preview and PWA Offline Routes";
      console.log(`[E2E] Running ${label}...`);
      const context = await createContext();
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/theme-preview", status: 200 });

      const resPreview = await page.goto(`${base}/theme-preview`, { waitUntil: "domcontentloaded" });
      assert(resPreview?.status() === 200, `Expected 200 for /theme-preview, got ${resPreview?.status()}`);

      const resOffline = await page.goto(`${base}/~offline`, { waitUntil: "domcontentloaded" });
      assert(resOffline?.status() === 200, `Expected 200 for /~offline, got ${resOffline?.status()}`);

      checkErrors();
      await context.close();
      console.log(`[E2E] ok ${label}`);
    }

    // -------------------------------------------------------------------------
    // Test 5: Profile Route (Signed-out View and Search History Panel)
    // -------------------------------------------------------------------------
    {
      const label = "T5: Profile View (Signed-Out)";
      console.log(`[E2E] Running ${label}...`);
      const context = await createContext();
      const page = await context.newPage();
      const checkErrors = attachErrorCollector(page, label, { path: "/profile", status: 200 });

      const res = await page.goto(`${base}/profile`, { waitUntil: "domcontentloaded" });
      assert(res?.status() === 200, `Expected 200 for /profile, got ${res?.status()}`);

      const pageText = await page.textContent("body");
      assert(
        pageText?.includes("Sign in") || pageText?.includes("sign in") || pageText?.includes("登录") || pageText?.includes("Search history"),
        "Signed-out profile prompt or search history panel not rendered",
      );

      checkErrors();
      await context.close();
      console.log(`[E2E] ok ${label}`);
    }

    // Registry gates (BRAWUKA-704): T2b/T6/T7/T8 live in lib/e2e-gates.mjs.
    await runRegistryGates(
      {
        base,
        cafeId: E2E_CAFE_ID,
        cafeName: "E2E Smoke Cafe",
        userId: E2E_USER_ID,
        dbClient,
        createContext,
        attachErrorCollector,
      },
      { hasDb, viewport: E2E_VIEWPORT },
    );
  } finally {
    await cleanup();
  }
  if (failures.length > 0) {
    console.error(`\n[E2E] Suite failed with ${failures.length} issue(s):\n`);
    for (const f of failures) {
      console.error(`  - ${f}\n`);
    }
    process.exit(1);
  }

  console.log("\n[E2E] Deterministic MVP smoke suite PASSED cleanly.\n");
}

runSmokeSuite().catch(async (err) => {
  console.error("\n[E2E] Fatal error during smoke suite:", err);
  await cleanup();
  process.exit(1);
});
