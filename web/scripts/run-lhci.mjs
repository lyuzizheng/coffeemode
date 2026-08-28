#!/usr/bin/env node
/**
 * Lighthouse CI Runner with Deterministic DB Fixtures (Issue #220, refactored in #271).
 *
 * Sets up isolated Postgres fixtures (E2E_USER_ID, E2E_CAFE_ID, E2E_CHECKIN_ID),
 * boots the Next.js standalone server with production assets, sets up the Chrome
 * binary path from Playwright if needed, and runs `lhci autorun`.
 *
 * Guarantees self-cleaning teardown on exit or failure.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupDbFixtures,
  cleanupDbFixtures,
  closeDbClient,
  DEFAULT_DATABASE_URL,
} from "./lib/e2e-fixtures.mjs";
import {
  getFreePort,
  spawnStandaloneServer,
  waitForServer,
  registerProcessCleanup,
} from "./lib/standalone-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

if (!process.env.LHCI_BASE_URL && !existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("No production build found in web/.next — run `npm run build` first.");
  process.exit(1);
}

let serverProcess = null;
let dbClient = null;

const cleanup = async () => {
  if (serverProcess) {
    try { serverProcess.kill("SIGTERM"); } catch {}
    serverProcess = null;
  }
  await cleanupDbFixtures(dbClient);
  if (dbClient) {
    await closeDbClient(dbClient);
    dbClient = null;
  }
};

registerProcessCleanup(cleanup);

// Auto-resolve Chromium path from Playwright if not already set
async function ensureChromePath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return;
  }
  try {
    const { chromium } = await import("playwright");
    const executable = chromium.executablePath();
    if (executable && existsSync(executable)) {
      process.env.CHROME_PATH = executable;
    }
  } catch {}
}

async function runLhci() {
  const port = process.env.LHCI_PORT ? Number(process.env.LHCI_PORT) : await getFreePort();
  const base = process.env.LHCI_BASE_URL ?? `http://127.0.0.1:${port}`;

  await ensureChromePath();
  const fixtureResult = await setupDbFixtures({ dbUrl, tag: "[LHCI]" });
  const hasDb = fixtureResult.hasDb;
  dbClient = fixtureResult.dbClient;
  console.log(`[LHCI] DB fixture initialized: ${hasDb ? "yes (Postgres)" : "no"}`);

  if (!process.env.LHCI_BASE_URL) {
    serverProcess = spawnStandaloneServer({
      cwd: root,
      port,
      stdio: "ignore",
      env: {
        DATABASE_URL: dbUrl,
      },
    });
  }

  try {
    await waitForServer(base);
    console.log(`[LHCI] Web server ready at ${base}`);

    console.log("[LHCI] Running Lighthouse CI autorun...");
    const lhciProcess = spawn("npx", ["lhci", "autorun"], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        LHCI_PORT: String(port),
        LHCI_BASE_URL: base,
      },
    });

    const exitCode = await new Promise((resolve) => {
      lhciProcess.on("close", resolve);
    });

    if (exitCode !== 0) {
      console.error(`[LHCI] Lighthouse CI autorun exited with code ${exitCode}`);
      process.exitCode = exitCode ?? 1;
    } else {
      console.log("[LHCI] Lighthouse CI autorun completed successfully.");
    }
  } finally {
    await cleanup();
  }
}

runLhci().catch(async (err) => {
  console.error("[LHCI] Fatal error during Lighthouse CI execution:", err);
  await cleanup();
  process.exit(1);
});
