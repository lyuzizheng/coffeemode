#!/usr/bin/env node
/**
 * CafeMood work_stats nightly recompute — idempotent drift correction.
 *
 * Thin loader: the real implementation is the canonical TS path
 * (`recomputeAllWorkStats` in lib/stats/aggregate.ts — per-cafe FOR UPDATE
 * transaction + RECOMPUTE_CONCURRENCY=4 worker pool, BRAWUKA-652), compiled
 * to `scripts/dist/recompute-work-stats.mjs` by esbuild. The previous
 * version of this file re-implemented the stats math in plain JS and had
 * already drifted from the TS path (no socialWeight, stale weight
 * literals); BRAWUKA-664 removed the duplicate implementation.
 *
 * Bundle lifecycle:
 *   - `npm run build` rebuilds it (`--build` flag below), so the Docker
 *     image ships the compiled file under /app/scripts/dist/.
 *   - A direct `npm run recompute:work-stats` in dev builds it on demand
 *     when missing — no separate build step to remember.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/recompute-work-stats.mjs
 *   npm run recompute:work-stats
 *   node scripts/recompute-work-stats.mjs --build   # rebuild bundle only
 *
 * Failures are observable: the process exits non-zero and logs the error,
 * so a cron (Dokploy scheduled job or VPS crontab) can alert.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(__dirname, "lib", "recompute-work-stats.ts");
const BUNDLE = path.join(__dirname, "dist", "recompute-work-stats.mjs");
const SERVER_ONLY_STUB = path.join(__dirname, "lib", "server-only-stub.mjs");

/** Compile the TS entry into scripts/dist/. npm deps stay external — they
 *  resolve from node_modules at runtime (dev install, or the standalone
 *  image's traced node_modules + the Dockerfile's explicit yaml copy). */
async function buildBundle() {
  const { build } = await import("esbuild");
  await build({
    entryPoints: [ENTRY],
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    alias: { "server-only": SERVER_ONLY_STUB },
    logLevel: "warning",
  });
  console.log(`built ${path.relative(process.cwd(), BUNDLE)}`);
}

async function main() {
  const buildOnly = process.argv.includes("--build");
  if (buildOnly || !existsSync(BUNDLE)) {
    await buildBundle();
    if (buildOnly) return;
  }
  await import(pathToFileURL(BUNDLE).href);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  });
}
