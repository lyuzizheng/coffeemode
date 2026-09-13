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
  reportServerRenderErrors,
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

function slug(route) {
  return route.replace(/^[~/]+/, "").replace(/[~/]/g, "-") || "home";
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
}

registerProcessCleanup(cleanup);

async function runVisualSmoke() {
  const port = process.env.VISUAL_PORT ? Number(process.env.VISUAL_PORT) : await getFreePort();
  const base = process.env.VISUAL_BASE_URL ?? `http://127.0.0.1:${port}`;

  const failures = [];

  if (!process.env.VISUAL_BASE_URL) {
    serverProcess = spawnStandaloneServer({
      cwd: root,
      port,
      // stderr only: the server's render errors are invisible to the
      // browser-side collectors below, so this gate has to read them itself.
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        DATABASE_URL: dbUrl,
      },
    });
    reportServerRenderErrors(serverProcess, { failures });
  }

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
          // Cafe covers live on the R2 CDN (`NEXT_PUBLIC_R2_PUBLIC_URL`). Whether
          // a local seed's cover host resolves is not this gate's business; an
          // unreachable CDN would fail the run on image loads before any status
          // or contrast assertion is read.
          await context.route("**/images.coffeemode.app/**", (r) =>
            r.fulfill({ status: 200, contentType: "image/svg+xml", body: PLACEHOLDER_COVER }),
          );

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

          // Spec 0002 AA gate — see contrastProblems above. Reporting stays a
          // single if/else: the file's frozen suppression budget (spec 0009)
          // covers exactly two depth violations here, and a branch chain would
          // silently spend more.
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
