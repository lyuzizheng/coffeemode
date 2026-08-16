#!/usr/bin/env node
// Rendered-page smoke gate (issue #76): boots the production build and
// screenshots the public route matrix, failing on non-2xx responses,
// console errors, or page errors. Screenshots land in .visual-smoke/ and
// are uploaded as a CI artifact on failure. No pixel baselines yet —
// step one is "CI looks at the rendered app".
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".visual-smoke");
const port = 3107;
const base = `http://127.0.0.1:${port}`;

const ROUTES = ["/", "/theme-preview", "/~offline"];
const COLOR_SCHEMES = ["light", "dark"];
const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true },
  desktop: { width: 1440, height: 900, isMobile: false },
};

if (!existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("no production build found — run `npm run build` first");
  process.exit(1);
}

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not start on ${base}`);
}

function slug(route) {
  return route.replace(/[~/]/g, "") || "home";
}

const server = spawn(
  join(root, "node_modules", ".bin", "next"),
  ["start", "-p", String(port), "-H", "127.0.0.1"],
  { cwd: root, stdio: "ignore" },
);
process.on("exit", () => server.kill("SIGTERM"));

const failures = [];

try {
  await waitForServer();
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const route of ROUTES) {
      for (const scheme of COLOR_SCHEMES) {
        for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
          const label = `${route} ${scheme} ${vpName}`;
          const context = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            colorScheme: scheme,
            isMobile: vp.isMobile,
            deviceScaleFactor: vp.isMobile ? 2 : 1,
          });
          const page = await context.newPage();
          const errors = [];
          page.on("console", (msg) => {
            if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
          });
          page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

          const res = await page.goto(base + route, { waitUntil: "networkidle" });
          const status = res ? res.status() : 0;
          if (status < 200 || status >= 300) {
            errors.push(`HTTP ${status}`);
          }

          await page.screenshot({
            path: join(outDir, `${slug(route)}-${scheme}-${vpName}.png`),
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
    await browser.close();
  }
} finally {
  server.kill("SIGTERM");
}

if (failures.length > 0) {
  console.error(`\nvisual smoke failed (${failures.length}):`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`\nvisual smoke passed: ${ROUTES.length * COLOR_SCHEMES.length * Object.keys(VIEWPORTS).length} renderings clean`);
