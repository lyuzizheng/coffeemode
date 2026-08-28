#!/usr/bin/env node
/**
 * Lighthouse CI Runner with Deterministic DB Fixtures (Issue #220).
 *
 * Sets up isolated Postgres fixtures (E2E_USER_ID, E2E_CAFE_ID, E2E_CHECKIN_ID),
 * boots the Next.js standalone server with production assets, sets up the Chrome
 * binary path from Playwright if needed, and runs `lhci autorun`.
 *
 * Guarantees self-cleaning teardown on exit or failure.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "./migrate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.LHCI_PORT ?? 3109);
const base = process.env.LHCI_BASE_URL ?? `http://127.0.0.1:${port}`;

const E2E_USER_ID = "e2e00000-0000-4000-a000-000000000001";
const E2E_CAFE_ID = "e2e00000-0000-4000-a000-000000000002";
const E2E_CHECKIN_ID = "e2e00000-0000-4000-a000-000000000003";

if (!existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("No production build found in web/.next — run `npm run build` first.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// DB Fixture Management (Self-Cleaning)
// ---------------------------------------------------------------------------
const dbUrl = process.env.DATABASE_URL ?? "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
let dbClient = null;

async function setupDbFixtures() {
  try {
    dbClient = new pg.Client({ connectionString: dbUrl });
    await dbClient.connect();
    await applyMigrations(dbClient);
    await cleanupDbFixtures();

    await dbClient.query(
      `insert into profiles (id, display_name, current_city)
       values ($1, 'E2E Nomad', 'San Francisco')
       on conflict (id) do update set display_name = 'E2E Nomad'`,
      [E2E_USER_ID],
    );

    const seedWorkStats = JSON.stringify({
      n_users: 1,
      n_checkins: 1,
      dims: {
        wifi: { sum: 90, n: 1 },
        outlets: { sum: 85, n: 1 },
        seats: { sum: 80, n: 1 },
        temp: { sum: 75, n: 1 },
        coffee: { sum: 85, n: 1 },
        overall: { sum: 85, n: 1 },
      },
      policies: {
        max_stay: { "3h": 1 },
      },
      experience_score: 85,
      composite_score: 84,
      updated_at: new Date().toISOString(),
    });

    await dbClient.query(
      `insert into cafes (id, name, address, location, city, created_by, tz, gallery, work_stats)
       values (
         $1,
         'E2E Smoke Cafe',
         '123 Smoke Test Lane',
         ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography,
         'San Francisco',
         $2,
         'America/Los_Angeles',
         '[]'::jsonb,
         $3::jsonb
       )`,
      [E2E_CAFE_ID, E2E_USER_ID, seedWorkStats],
    );

    await dbClient.query(
      `insert into checkins (id, cafe_id, user_id, is_creation, note, scores, max_stay, photos, visited_at)
       values (
         $1,
         $2,
         $3,
         true,
         'Great nomad setup for testing with fast wifi and outlets.',
         '{"wifi": 90, "outlets": 85, "seats": 80, "temp": 75, "coffee": 85, "overall": 85}'::jsonb,
         '3h',
         '[]'::jsonb,
         now()
       )`,
      [E2E_CHECKIN_ID, E2E_CAFE_ID, E2E_USER_ID],
    );
    return true;
  } catch (err) {
    if (process.env.CI) {
      console.error("[LHCI] DB fixture initialization failed in CI:", err);
      throw err;
    }
    if (dbClient) {
      try { await dbClient.end(); } catch {}
      dbClient = null;
    }
    return false;
  }
}

async function cleanupDbFixtures() {
  if (!dbClient) return;
  try {
    await dbClient.query(`delete from checkins where cafe_id = $1 or id = $2`, [E2E_CAFE_ID, E2E_CHECKIN_ID]);
    await dbClient.query(`delete from cafes where id = $1`, [E2E_CAFE_ID]);
    await dbClient.query(`delete from profiles where id = $1`, [E2E_USER_ID]);
  } catch {}
}

// ---------------------------------------------------------------------------
// Standalone Server Lifecycle
// ---------------------------------------------------------------------------
async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not start within 30s at ${base}`);
}

function spawnStandaloneServer({ cwd, port, host = "127.0.0.1", env = {} }) {
  const standaloneDir = join(cwd, ".next", "standalone");
  const serverPath = join(standaloneDir, "server.js");
  if (!existsSync(serverPath)) {
    throw new Error(`Standalone server not found at ${serverPath}. Run \`npm run build\` first.`);
  }

  // Next standalone requires static assets copied in
  const staticSrc = join(cwd, ".next", "static");
  const staticDest = join(standaloneDir, ".next", "static");
  if (existsSync(staticSrc)) {
    cpSync(staticSrc, staticDest, { recursive: true, force: true });
  }

  const publicSrc = join(cwd, "public");
  const publicDest = join(standaloneDir, "public");
  if (existsSync(publicSrc)) {
    cpSync(publicSrc, publicDest, { recursive: true, force: true });
  }

  return spawn(process.execPath, [serverPath], {
    cwd: standaloneDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOSTNAME: host,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
}

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
  await ensureChromePath();
  const hasDb = await setupDbFixtures();
  console.log(`[LHCI] DB fixture initialized: ${hasDb ? "yes (Postgres)" : "no"}`);

  const serverProcess = spawnStandaloneServer({
    cwd: root,
    port,
    env: {
      DATABASE_URL: dbUrl,
    },
  });

  serverProcess.stderr.on("data", (d) => {
    const s = d.toString();
    if (!s.includes("ExperimentalWarning")) {
      process.stderr.write(`[Next.js Server ERROR] ${s}`);
    }
  });

  const cleanup = async () => {
    if (serverProcess) {
      try { serverProcess.kill("SIGTERM"); } catch {}
    }
    await cleanupDbFixtures();
    if (dbClient) {
      try { await dbClient.end(); } catch {}
      dbClient = null;
    }
  };

  process.on("exit", () => {
    if (serverProcess) {
      try { serverProcess.kill("SIGTERM"); } catch {}
    }
  });
  process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
  process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

  try {
    await waitForServer();
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
  process.exit(1);
});
