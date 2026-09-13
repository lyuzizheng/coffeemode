#!/usr/bin/env node
// Rendered-page smoke gate (issue #76, hardened in #248, refactored in #271):
// boots the production standalone build on an ephemeral port and screenshots the
// public route matrix, failing on unexpected HTTP statuses (per-route
// expectation — the 404 route must return 404), console errors, page errors, or
// any rendered text under its WCAG AA contrast threshold (BRAWUKA-219 — the
// painted-byte audit in lib/contrast-audit.mjs). Screenshots land in
// .visual-smoke/ and are uploaded as a CI artifact on failure.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { auditPageContrast, formatContrastOffenders } from "./lib/contrast-audit.mjs";
import {
  getFreePort,
  spawnStandaloneServer,
  waitForServer,
  registerProcessCleanup,
} from "./lib/standalone-server.mjs";
import {
  E2E_CAFE_ID,
  setupDbFixtures,
  cleanupDbFixtures,
  closeDbClient,
} from "./lib/e2e-fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".visual-smoke");
const dbUrl = process.env.DATABASE_URL ?? "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

// Each entry declares its expected HTTP status; the 404 routes keep the
// designed not-found pages inside the rendered gate (issue #99). `prepare`
// drives interactive entries into their rendered state before the
// screenshot — the check-in drawer needs the seeded cafe page, so it is
// skipped when the DB fixture is unavailable (the fail-closed seed guard
// still applies: ALLOW_SEED_DEV_DB=1 to run locally).
const ENTRIES = [
  { name: "home", path: "/", status: 200 },
  { name: "theme-preview", path: "/theme-preview", status: 200 },
  { name: "offline", path: "/~offline", status: 200 },
  { name: "definitely-not-a-route", path: "/definitely-not-a-route", status: 404 },
  // seo-sharing (#150): a gone/invalid cafe id renders the designed cafe 404
  // (real 404 status, DG19). DB-independent: the id can never resolve.
  { name: "cafes-definitely-not-a-cafe", path: "/cafes/definitely-not-a-cafe", status: 404 },
  {
    name: "checkin-drawer",
    path: `/cafes/${E2E_CAFE_ID}`,
    status: 200,
    needsDb: true,
    async prepare(page) {
      const trigger = page.getByRole("button", { name: /Check in|Check-in|打卡/i }).first();
      await trigger.waitFor({ state: "visible", timeout: 15000 });
      const dialog = page.locator("section.drawer__dialog--bottom");
      for (let attempt = 0; attempt < 20 && !(await dialog.isVisible()); attempt++) {
        await trigger.click();
        await dialog.waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
      }
      if (!(await dialog.isVisible())) throw new Error("check-in drawer did not open");
    },
  },
];
const COLOR_SCHEMES = ["light", "dark"];

/** Stand-in for a cafe cover when the R2 CDN is stubbed (see the route table). */
const PLACEHOLDER_COVER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="#e7e2dc"/></svg>';

const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true },
  desktop: { width: 1440, height: 900, isMobile: false },
};

if (!process.env.VISUAL_BASE_URL && !existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("no production build found — run `npm run build` first");
  process.exit(1);
}


/**
 * Spec 0002 AA gate: body text >= 4.5:1, large text >= 3:1, measured from the
 * browser's own painted bytes (alpha, tint and mixing included). Decorative
 * `aria-hidden` subtrees and inactive controls are exempt inside the audit. A
 * rendering with no text to measure is a broken audit, not a pass.
 */
function contrastProblems(label, contrast) {
  const coverage = `contrast: ${contrast.checked} text samples, ${contrast.decorative} decorative exempt`;
  if (contrast.checked === 0) return [`${label} [${coverage}] — the audit measured no text at all`];
  if (contrast.offenders.length === 0) return [];
  return [formatContrastOffenders(`${label} [${coverage}]`, contrast.offenders)];
}

let serverProcess = null;
let browser = null;
let dbClient = null;

async function cleanup() {
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
  if (dbClient) {
    try {
      await cleanupDbFixtures(dbClient);
      await closeDbClient(dbClient);
    } catch {
      // Benign: best-effort fixture teardown.
    }
    dbClient = null;
  }
}

registerProcessCleanup(cleanup);

async function runVisualSmoke() {
  const port = process.env.VISUAL_PORT ? Number(process.env.VISUAL_PORT) : await getFreePort();
  const base = process.env.VISUAL_BASE_URL ?? `http://127.0.0.1:${port}`;
  // Seed the shared fixtures so the interactive entries (check-in drawer)
  // have a real cafe page to open on. No DB or a refused seed target just
  // skips those entries — the static route matrix still runs.
  let hasDb = false;
  try {
    const fixture = await setupDbFixtures({ dbUrl, tag: "[visual]" });
    hasDb = fixture.hasDb;
    dbClient = fixture.dbClient;
  } catch (err) {
    console.warn(`[visual] DB fixture unavailable, interactive entries skipped: ${err?.message ?? err}`);
  }


  if (!process.env.VISUAL_BASE_URL) {
    serverProcess = spawnStandaloneServer({
      cwd: root,
      port,
      env: {
        DATABASE_URL: dbUrl,
      },
    });
  }

  const failures = [];

  /**
   * One browser context with the third-party stubs every rendering shares.
   */
  async function newStubbedContext(vp, scheme) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: scheme,
      isMobile: vp.isMobile,
      deviceScaleFactor: vp.isMobile ? 2 : 1,
    });
    // Stub 3rd party networks to eliminate CI flakiness
    await context.route("**/*apple-mapkit*", (r) => r.fulfill({ status: 200, body: "" }));
    await context.route("**/*maps.googleapis.com*", (r) => r.fulfill({ status: 200, json: { status: "OK", results: [] } }));
    await context.route("**/api/mapkit-token", (r) => r.fulfill({ status: 200, json: { token: "fake-mapkit-token" } }));
    // Cafe covers live on the R2 CDN (`NEXT_PUBLIC_R2_PUBLIC_URL`). Whether
    // a local seed's cover host resolves is not this gate's business; an
    // unreachable CDN would fail the run on image loads before any status
    // or contrast assertion is read.
    await context.route("**/images.coffeemode.app/**", (r) =>
      r.fulfill({ status: 200, contentType: "image/svg+xml", body: PLACEHOLDER_COVER }),
    );
    return context;
  }

  /**
   * Console/pageerror collector. `expected` exempts the document's own
   * non-2xx when that status is the route's contract (the 404 fixture); the
   * drawer's signed-out last-check-in probe 401 is likewise contractual
   * (DG64/DG105 — anonymous answer → sign-in gate), exempt on every entry.
   */
  function attachErrorListeners(page, errors, expected) {
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      if (
        expected.status >= 400 &&
        msg.location()?.url === base + expected.path &&
        msg.text().startsWith(
          `Failed to load resource: the server responded with a status of ${expected.status} `,
        )
      ) {
        return;
      }
      if (
        msg.location()?.url?.startsWith(`${base}/api/checkins/last`) &&
        msg.text().startsWith(
          "Failed to load resource: the server responded with a status of 401 ",
        )
      ) {
        return;
      }
      errors.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  }

  /**
   * Screenshot + spec 0002 AA contrast audit for one rendered page; pushes a
   * formatted failure or logs the ok line. Reporting stays a single if/else:
   * the file's frozen suppression budget (spec 0009) covers exactly two
   * depth violations here, and a branch chain would silently spend more.
   */
  async function auditRendering({ page, context, label, errors, shotName }) {
    await page.screenshot({ path: join(outDir, `${shotName}.png`), fullPage: true });
    const contrast = await auditPageContrast(page);
    const problems = [
      ...(errors.length > 0 ? [`${label}\n    ${errors.join("\n    ")}`] : []),
      ...contrastProblems(label, contrast),
    ];
    await context.close();
    if (problems.length > 0) {
      failures.push(problems.join("\n"));
    } else {
      console.log(
        `ok ${label} (contrast: ${contrast.checked} text samples, ${contrast.decorative} decorative exempt)`,
      );
    }
  }

  /** One rendering of one entry at one scheme/viewport: load, optional
   *  interactive prepare, screenshot, contrast audit. */
  async function renderEntry({ entry, scheme, vpName, vp }) {
    const label = `${entry.name} ${scheme} ${vpName}`;
    const context = await newStubbedContext(vp, scheme);
    const page = await context.newPage();
    const errors = [];
    attachErrorListeners(page, errors, entry);

    const res = await page.goto(base + entry.path, { waitUntil: "networkidle" });
    const status = res ? res.status() : 0;
    if (status !== entry.status) {
      errors.push(`HTTP ${status}, expected ${entry.status}`);
    }

    if (entry.prepare) {
      try {
        await entry.prepare(page);
      } catch (err) {
        errors.push(`prepare failed: ${err?.message ?? err}`);
      }
    }

    await auditRendering({
      page,
      context,
      label,
      errors,
      shotName: `${entry.name}-${scheme}-${vpName}`,
    });
  }

  try {
    await waitForServer(base);
    mkdirSync(outDir, { recursive: true });

    browser = await chromium.launch({ headless: true });
    for (const entry of ENTRIES) {
      if (entry.needsDb && !hasDb) {
        console.log(`skip ${entry.name} (no DB fixture)`);
        continue;
      }
      for (const scheme of COLOR_SCHEMES) {
        for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
          await renderEntry({ entry, scheme, vpName, vp });
        }
      }
    }
  } finally {
    await cleanup();
  }

  if (failures.length > 0) {
    console.error(`\nvisual smoke failed (${failures.length}):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(`\nvisual smoke passed: ${ENTRIES.length * COLOR_SCHEMES.length * Object.keys(VIEWPORTS).length} renderings clean`);
}

runVisualSmoke().catch(async (err) => {
  console.error("\n[Visual Smoke] Fatal error during visual smoke suite:", err);
  await cleanup();
  process.exit(1);
});
