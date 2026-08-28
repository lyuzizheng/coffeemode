#!/usr/bin/env node
// Rendered-page smoke gate (issue #76, hardened in #248, refactored in #271): boots the production
// standalone build on an ephemeral port and screenshots the public route matrix,
// failing on unexpected HTTP statuses (per-route expectation — the 404 route must
// return 404), console errors, or page errors. Screenshots land in .visual-smoke/
// and are uploaded as a CI artifact on failure.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  getFreePort,
  spawnStandaloneServer,
  waitForServer,
  registerProcessCleanup,
} from "./lib/standalone-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".visual-smoke");
const dbUrl = process.env.DATABASE_URL ?? "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

// Each route declares its expected HTTP status; the 404 route keeps the
// designed not-found page inside the rendered gate (issue #99).
const ROUTES = [
  { path: "/", status: 200 },
  { path: "/theme-preview", status: 200 },
  { path: "/~offline", status: 200 },
  { path: "/definitely-not-a-route", status: 404 },
  // seo-sharing (#150): a gone/invalid cafe id renders the designed cafe 404
  // (real 404 status, DG19). DB-independent: the id can never resolve.
  { path: "/cafes/definitely-not-a-cafe", status: 404 },
];
const COLOR_SCHEMES = ["light", "dark"];
const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true },
  desktop: { width: 1440, height: 900, isMobile: false },
};

if (!process.env.VISUAL_BASE_URL && !existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("no production build found — run `npm run build` first");
  process.exit(1);
}

function slug(route) {
  return route.replace(/^[~/]+/, "").replace(/[~/]/g, "-") || "home";
}

let serverProcess = null;
let browser = null;

async function cleanup() {
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
  }
  if (serverProcess) {
    try {
      serverProcess.kill("SIGTERM");
    } catch {}
    serverProcess = null;
  }
}

registerProcessCleanup(cleanup);

async function runVisualSmoke() {
  const port = process.env.VISUAL_PORT ? Number(process.env.VISUAL_PORT) : await getFreePort();
  const base = process.env.VISUAL_BASE_URL ?? `http://127.0.0.1:${port}`;

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

  try {
    await waitForServer(base);
    mkdirSync(outDir, { recursive: true });

    browser = await chromium.launch({ headless: true });
    for (const route of ROUTES) {
      for (const scheme of COLOR_SCHEMES) {
        for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
          const label = `${route.path} ${scheme} ${vpName}`;
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

          const page = await context.newPage();
          const errors = [];
          page.on("console", (msg) => {
            if (msg.type() !== "error") return;
            // Chromium logs the document's own non-2xx response as a console
            // error; when that status is the route's expectation (the 404
            // fixture), it is the contract, not a fault. Gated on the message
            // source being the document itself so a subresource failure with
            // the same status still fails the gate.
            if (
              route.status >= 400 &&
              msg.location()?.url === base + route.path &&
              msg.text().startsWith(
                `Failed to load resource: the server responded with a status of ${route.status} `,
              )
            ) {
              return;
            }
            errors.push(`console.error: ${msg.text()}`);
          });
          page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

          const res = await page.goto(base + route.path, { waitUntil: "networkidle" });
          const status = res ? res.status() : 0;
          if (status !== route.status) {
            errors.push(`HTTP ${status}, expected ${route.status}`);
          }

          await page.screenshot({
            path: join(outDir, `${slug(route.path)}-${scheme}-${vpName}.png`),
            fullPage: true,
          });
          await context.close();

          if (errors.length > 0) {
            failures.push(`${label}\n    ${errors.join("\n    ")}`);
          } else {
            console.log(`ok ${label}`);
          }
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
  console.log(`\nvisual smoke passed: ${ROUTES.length * COLOR_SCHEMES.length * Object.keys(VIEWPORTS).length} renderings clean`);
}

runVisualSmoke().catch(async (err) => {
  console.error("\n[Visual Smoke] Fatal error during visual smoke suite:", err);
  await cleanup();
  process.exit(1);
});
