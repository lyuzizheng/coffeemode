#!/usr/bin/env node
/**
 * Closed-beta admission E2E (BRAWUKA-970, spec 0001 §Closed beta).
 *
 * Proves the three identities the release gate names, against a REAL
 * production build with the gate ON (`BETA_MODE=1` — the product default):
 *
 *   1. anonymous  — `/` and a cafe deep link show the beta surface, and the
 *                   API answers 401 (the gate is not UI-only);
 *   2. refused    — a verified session whose address is not on
 *                   `beta_allowlist` lands on the refusal copy;
 *   3. admitted   — an allowlisted address reaches the product shell.
 *
 * Screenshots of each state are the issue's delivery evidence
 * (`web/.e2e-artifacts/beta-gate/`). The allowlist row this script writes is
 * removed on exit, so the run is idempotent and leaves no fixture behind.
 *
 * Env: DATABASE_URL, E2E_SUPABASE_URL, E2E_SUPABASE_PUBLISHABLE_KEY,
 * E2E_BASE_URL (reuse a running gated server instead of spawning one).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pg from "pg";
import { shot } from "./lib/gate-assert.mjs";
import { clearGateArtifacts } from "./lib/e2e-artifacts.mjs";
import { DEFAULT_DATABASE_URL, E2E_CAFE_ID, E2E_USER_ID } from "./lib/e2e-fixtures.mjs";
import { mintSession } from "./lib/e2e-session.mjs";
import {
  getFreePort,
  registerProcessCleanup,
  spawnStandaloneServer,
  waitForServer,
} from "./lib/standalone-server.mjs";
import { stubOpenFreeMap } from "./lib/tile-stubs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const supabaseAnonKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "e2e-anon-key";
const SLUG = "beta-gate";

/** The address the operator CLI would have invited; deleted on exit. */
const INVITED_EMAIL = "beta.invited@coffeemode.test";
const REFUSED_EMAIL = "beta.stranger@coffeemode.test";
const REFUSED_ID = "e2e00000-0000-4000-a000-00000000b970";

const BETA_HEADING = /in closed beta/i;
const REFUSAL_HEADING = /isn.t invited yet/i;

let server = null;
let browser = null;
let dbClient = null;

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function seedAllowlist() {
  dbClient = new pg.Client({ connectionString: dbUrl });
  await dbClient.connect();
  await dbClient.query(
    `insert into beta_allowlist (email, note) values ($1, 'e2e beta login')
     on conflict (email) do update set note = excluded.note, revoked_at = null`,
    [INVITED_EMAIL],
  );
  await dbClient.query("delete from beta_allowlist where email = $1", [REFUSED_EMAIL]);
}

async function dropAllowlist() {
  if (!dbClient) return;
  try {
    await dbClient.query("delete from beta_allowlist where email in ($1, $2)", [
      INVITED_EMAIL,
      REFUSED_EMAIL,
    ]);
  } finally {
    await dbClient.end();
    dbClient = null;
  }
}

/** A context with the third-party boundaries stubbed (map tiles, MapKit). */
async function newContext(viewport, locale) {
  const context = await browser.newContext({ viewport, locale });
  await context.route("**/*apple-mapkit*", (route) => route.fulfill({ status: 200, body: "" }));
  await context.route("**/*maps.googleapis.com*", (route) =>
    route.fulfill({ status: 200, json: { status: "OK", results: [] } }),
  );
  await context.route("**/api/mapkit-token", (route) =>
    route.fulfill({ status: 200, json: { token: "e2e-fake-mapkit-token" } }),
  );
  await stubOpenFreeMap(context);
  return context;
}

async function anonymous() {
  const context = await newContext({ width: 1280, height: 800 }, "en-US");
  const page = await context.newPage();
  const home = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  if (home?.status() !== 200) throw new Error(`anonymous / returned ${home?.status()}`);

  await page.getByRole("heading", { name: BETA_HEADING }).waitFor({ timeout: 20000 });
  // No second front door: the beta page must not offer signup or passwords.
  const signupLinks = page.getByRole("link", { name: /sign up|register|create account/i });
  if ((await signupLinks.count()) !== 0) throw new Error("beta page offers a signup link");
  if ((await page.getByRole("button", { name: /continue with google/i }).count()) !== 1) {
    throw new Error("beta page does not offer exactly one Google sign-in button");
  }
  await shot(page, SLUG, "anonymous-home");

  const deepLink = await page.goto(`${base}/cafes/${E2E_CAFE_ID}`, {
    waitUntil: "domcontentloaded",
  });
  if (deepLink?.status() !== 200) throw new Error(`anonymous deep link returned ${deepLink?.status()}`);
  await page.getByRole("heading", { name: BETA_HEADING }).waitFor({ timeout: 20000 });

  const api = await context.request.get(`${base}/api/cafes?lat=1.35&lng=103.8`);
  if (api.status() !== 401) throw new Error(`anonymous API returned ${api.status()}, expected 401`);
  const envelope = await api.json();
  if (envelope.error !== "unauthorized") {
    throw new Error(`anonymous API envelope was ${JSON.stringify(envelope.error)}`);
  }
  await context.close();

  // The same surface must hold up on a phone: one column, same copy, same
  // single sign-in path (the issue's mobile/desktop requirement).
  const mobile = await newContext({ width: 390, height: 844 }, "en-US");
  try {
    const narrow = await mobile.newPage();
    await narrow.goto(`${base}/`, { waitUntil: "domcontentloaded" });
    await narrow.getByRole("heading", { name: BETA_HEADING }).waitFor({ timeout: 20000 });
    const overflow = await narrow.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) throw new Error(`beta page overflows a 390px viewport by ${overflow}px`);
    await shot(narrow, SLUG, "anonymous-home-mobile");
  } finally {
    await mobile.close();
  }
  console.log(`[beta-gate] ok anonymous (page, deep link, API 401, mobile)`);
}

async function withMintedSession(email, userId, viewport, locale) {
  const minted = await mintSession(supabaseUrl, userId, email);
  if (!minted) throw new Error(`supabase-mock unreachable at ${supabaseUrl}`);
  const context = await newContext(viewport, locale);
  await context.addCookies([{ name: minted.name, value: minted.value, url: base }]);
  return { context, cookieName: minted.name };
}

async function refused() {
  const { context } = await withMintedSession(
    REFUSED_EMAIL,
    REFUSED_ID,
    { width: 1280, height: 800 },
    "en-US",
  );
  const page = await context.newPage();
  const home = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  if (home?.status() !== 200) throw new Error(`refused / returned ${home?.status()}`);
  await page.getByRole("heading", { name: REFUSAL_HEADING }).waitFor({ timeout: 20000 });
  if ((await page.getByText(REFUSED_EMAIL).count()) === 0) {
    throw new Error("refusal page does not name the signed-in account");
  }
  const shell = await page.locator("aside, canvas.maplibregl-canvas").count();
  if (shell !== 0) throw new Error("refused session reached the product shell");
  await shot(page, SLUG, "refused-home");
  await context.close();
  console.log("[beta-gate] ok refused (refusal copy, no product shell)");
}

async function admitted() {
  const { context } = await withMintedSession(
    INVITED_EMAIL,
    E2E_USER_ID,
    { width: 1280, height: 800 },
    "en-US",
  );
  const page = await context.newPage();
  const home = await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  if (home?.status() !== 200) throw new Error(`admitted / returned ${home?.status()}`);
  if ((await page.getByRole("heading", { name: BETA_HEADING }).count()) !== 0) {
    throw new Error("admitted session still shows the beta surface");
  }
  await page.locator("aside").first().waitFor({ timeout: 20000 });
  await shot(page, SLUG, "admitted-home");

  const api = await context.request.get(`${base}/api/cafes?lat=1.35&lng=103.8`);
  if (api.status() !== 200) throw new Error(`admitted API returned ${api.status()}, expected 200`);
  await context.close();
  console.log("[beta-gate] ok admitted (product shell, API 200)");
}

let base = "";

async function main() {
  if (!process.env.E2E_BASE_URL && !existsSync(join(root, ".next", "BUILD_ID"))) {
    throw new Error("No production build in web/.next — run `npm run build` first.");
  }
  if (!(await reachable(`${supabaseUrl}/auth/v1/health`))) {
    throw new Error(`supabase-mock is not reachable at ${supabaseUrl} (docker compose up -d --wait supabase-mock)`);
  }
  clearGateArtifacts(SLUG);
  await seedAllowlist();

  if (process.env.E2E_BASE_URL) {
    base = process.env.E2E_BASE_URL.replace(/\/$/, "");
  } else {
    const port = await getFreePort();
    base = `http://127.0.0.1:${port}`;
    server = spawnStandaloneServer({
      cwd: root,
      port,
      stdio: "ignore",
      env: {
        DATABASE_URL: dbUrl,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseAnonKey,
        // The subject of this suite: the released build's own default.
        BETA_MODE: "1",
      },
    });
    registerProcessCleanup(() => server?.kill("SIGTERM"));
    await waitForServer(base);
  }

  browser = await chromium.launch({ headless: true });
  await anonymous();
  await refused();
  await admitted();
  console.log(`[beta-gate] PASS — screenshots in web/.e2e-artifacts/${SLUG}/`);
}

try {
  await main();
} catch (error) {
  console.error(`[beta-gate] FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server?.kill("SIGTERM");
  await dropAllowlist().catch(() => {});
}
