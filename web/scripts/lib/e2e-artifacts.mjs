/**
 * Per-gate artifact collector for the E2E suite (BRAWUKA-704).
 *
 * Each registry gate owns `web/.e2e-artifacts/<gate-slug>/` (gitignored):
 *   - `trace.zip`   — Playwright `context.tracing` recording, retained only
 *                     when the gate fails (pass `failed: true` to
 *                     `stopGateTracing`).
 *   - `failure.png` — viewport screenshot at the failure point, captured in
 *                     the gate's catch block before the context closes.
 *   - `console.log` — the runner's `attachErrorCollector` payload for the
 *                     gate's pages, appended per page, plus the thrown error
 *                     via `recordGateFailure`.
 *
 * Gates may also record key-step screenshots on the success path via
 * `saveGateScreenshot` (wrapped as `shot` in `lib/gate-assert.mjs`). The
 * suite runs serially against a single DB (D5), so one directory per slug
 * needs no locking.
 */
import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Root of all gate artifact directories (gitignored). */
export const E2E_ARTIFACTS_DIR = join(webRoot, ".e2e-artifacts");

/** Directory holding one gate's artifacts. Pure — creates nothing. */
export function gateArtifactsDir(slug) {
  return join(E2E_ARTIFACTS_DIR, slug);
}

/** Fresh empty directory for a gate run; drops the previous run's files. */
export function clearGateArtifacts(slug) {
  const dir = gateArtifactsDir(slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureGateArtifactsDir(slug) {
  const dir = gateArtifactsDir(slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a traced context for one gate step. The gate drives
 * `gate.context`, then settles with `close({ failed, page })`: on failure
 * the failing page screenshots to `failure.png` and the recording is kept
 * as `trace.zip`; on success the recording is discarded. Only one step per
 * gate run can fail (the throw propagates), so the singular `trace.zip` /
 * `failure.png` names never collide across a gate's contexts.
 */
export async function openGateContext(createContext, slug, options = {}) {
  const context = await createContext(options);
  await startGateTracing(context);
  return {
    context,
    async close({ failed = false, page = null } = {}) {
      if (failed && page) {
        await saveGateScreenshot(page, slug, "failure");
      }
      await stopGateTracing(context, slug, { failed });
      await context.close();
    },
  };
}

/** Start a Playwright tracing recording; best-effort so gates never fail on it. */
export async function startGateTracing(context) {
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  } catch {
    // Benign: without tracing the gate still runs; only trace.zip is missing.
  }
}

/**
 * Stop the recording, keeping `trace.zip` only on failure. Never throws —
 * a missing recording must not mask the gate result.
 */
export async function stopGateTracing(context, slug, { failed = false } = {}) {
  try {
    if (failed) {
      await context.tracing.stop({ path: join(ensureGateArtifactsDir(slug), "trace.zip") });
    } else {
      await context.tracing.stop();
    }
  } catch {
    // Benign: see startGateTracing.
  }
}

/** Screenshot into the gate's directory; best-effort (the page may be gone). */
export async function saveGateScreenshot(page, slug, name) {
  try {
    await page.screenshot({ path: join(ensureGateArtifactsDir(slug), `${name}.png`) });
  } catch {
    // Benign: trace.zip still carries the visual state.
  }
}

/** Append one page's console/pageerror lines to the gate's `console.log`. */
export function recordGateConsole(slug, lines, label = slug) {
  if (lines.length === 0) return;
  appendFileSync(
    join(ensureGateArtifactsDir(slug), "console.log"),
    `${lines.map((line) => `[${label}] ${line}`).join("\n")}\n`,
  );
}

/** Record the thrown gate error alongside the console payload. */
export function recordGateFailure(slug, err) {
  appendFileSync(join(ensureGateArtifactsDir(slug), "console.log"), `gate failure: ${err?.message ?? err}\n`);
}

/**
 * Run one gate step inside a traced context. `drive(context, consoleLines)`
 * creates exactly one page, attaches the runner's error collector into
 * `consoleLines`, and returns the page. Both paths append the console
 * payload; failure additionally screenshots to `failure.png` and keeps
 * `trace.zip`, then the error propagates to the runner — which records it
 * via `recordGateFailure` so fetch-only gates without a page share the
 * same failure path.
 */
export async function withGateContext(slug, createContext, options, drive, label = slug) {
  const gate = await openGateContext(createContext, slug, options);
  let page = null;
  let failed = true;
  const consoleLines = [];
  try {
    page = await drive(gate.context, consoleLines);
    failed = false;
  } finally {
    // A throwing drive never returns its page — fall back to the context's
    // open pages so the failure screenshot still captures the failure point.
    recordGateConsole(slug, consoleLines, label);
    await gate.close({ failed, page: page ?? gate.context.pages().at(-1) ?? null });
  }
}
