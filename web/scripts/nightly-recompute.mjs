#!/usr/bin/env node
/**
 * CafeMood Nightly Recompute & Snapshot Runner (BRAWUKA-475 / BRAWUKA-476).
 *
 * Primary execution entrypoint for Dokploy scheduled jobs and VPS crontabs:
 * 1. scripts/recompute-work-stats.mjs (idempotent work_stats drift correction)
 * 2. scripts/snapshot-helpful-ranking.mjs (daily Helpful ranking snapshot, DG148)
 *
 * Failure Alerting:
 * On non-zero exit of either step, outputs a structured JSON error line
 * and sends an HTTP POST to MULTICA_AUTOPILOT_WEBHOOK_URL (if configured)
 * using native fetch with JSON.stringify (preventing any escaping defects).
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function sendFailureAlert(errorMsg, runPointer = "dokploy:cron:nightly-recompute") {
  const timestamp = new Date().toISOString();
  const jsonLog = {
    job: "nightly-recompute",
    status: "failed",
    error: errorMsg,
    run: runPointer,
    timestamp,
  };
  console.error(JSON.stringify(jsonLog));

  const webhookUrl = process.env.MULTICA_AUTOPILOT_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return;
  }

  try {
    const payload = {
      job: "nightly-recompute",
      error: errorMsg,
      run: runPointer,
    };
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[WARN] Autopilot webhook responded with HTTP ${res.status}`);
    } else {
      console.log(`[INFO] Autopilot webhook notification delivered successfully`);
    }
  } catch (err) {
    console.warn(`[WARN] Failed to deliver webhook to autopilot: ${err?.message || err}`);
  }
}

function runStep(name, scriptFilename) {
  const scriptPath = path.resolve(__dirname, scriptFilename);
  console.log(`[INFO] Starting step: ${name} (${scriptFilename})...`);

  const res = spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit",
    env: process.env,
  });

  if (res.status !== 0) {
    throw new Error(`Step '${name}' (${scriptFilename}) failed with exit code ${res.status}`);
  }
  console.log(`[OK] Step '${name}' completed successfully.`);
}

async function main() {
  const startTime = Date.now();
  console.log(`[INFO] Starting nightly recompute at ${new Date().toISOString()}...`);

  try {
    runStep("recompute-work-stats", "recompute-work-stats.mjs");
    runStep("snapshot-helpful-ranking", "snapshot-helpful-ranking.mjs");
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[OK] Nightly recompute and ranking snapshot completed successfully in ${duration}s.`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] Nightly recompute failed: ${errorMsg}`);
    await sendFailureAlert(errorMsg, "dokploy:cron:nightly-recompute");
    process.exit(1);
  }
}

main().catch(async (err) => {
  const errorMsg = String(err?.message || err);
  console.error("Fatal error in runner:", errorMsg);
  await sendFailureAlert(errorMsg, "dokploy:cron:nightly-recompute");
  process.exit(1);
});
