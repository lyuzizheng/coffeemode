#!/usr/bin/env node
/**
 * R2 orphan-original cleanup (issue #158) — safe, metadata-aware, dry-run first.
 *
 * Orphan definition (cannot match a completed/live gallery original):
 *   an `original/{uuid}.webp` object older than RETENTION_DAYS whose stored
 *   metadata lacks `x-amz-meta-targettype`. `POST /v1/images/complete` re-PUTs
 *   every completed original WITH targetType/targetId/userId metadata
 *   (image-service/src/index.ts), so a live gallery original always carries it.
 *   A pre-completion upload never does. Blanket age rules on `original/` are
 *   unsafe for exactly this reason — see issue #158.
 *
 * Safety properties:
 *   - DRY_RUN=1 (default) lists and reports without deleting.
 *   - Cursor-paginated listing (bounded by MAX_OBJECTS per run) and batched
 *     deletes (BATCH_SIZE); idempotent — re-running skips already-deleted keys.
 *   - Structured JSON summary per batch + final counts; non-zero exit only on
 *     operational failure (listing/auth), not on "nothing to delete".
 *
 * Usage (VPS cron / GitHub schedule via #154; least-privilege R2 creds):
 *   R2_ENDPOINT=https://{account}.r2.cloudflarestorage.com \
 *   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=... \
 *   DRY_RUN=1 RETENTION_DAYS=7 MAX_OBJECTS=1000 node clean-orphan-originals.mjs
 */

import { AwsClient } from "aws4fetch";

const R2_ENDPOINT = process.env.R2_ENDPOINT?.replace(/\/+$/, "");
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const DRY_RUN = process.env.DRY_RUN !== "0";
const RETENTION_DAYS = Number.parseInt(process.env.RETENTION_DAYS ?? "7", 10);
const MAX_OBJECTS = Number.parseInt(process.env.MAX_OBJECTS ?? "1000", 10);
const BATCH_SIZE = Math.min(Number.parseInt(process.env.BATCH_SIZE ?? "100", 10), 1000);

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || (!R2_ENDPOINT && !R2_ACCOUNT_ID)) {
  console.error(
    "clean-orphan-originals: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and (R2_ENDPOINT or R2_ACCOUNT_ID) are required",
  );
  process.exit(1);
}
if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS < 0) {
  console.error("clean-orphan-originals: RETENTION_DAYS must be a non-negative integer (0 = everything older than now)");
  process.exit(1);
}
if (!Number.isFinite(MAX_OBJECTS) || MAX_OBJECTS < 1) {
  console.error("clean-orphan-originals: MAX_OBJECTS must be a positive integer");
  process.exit(1);
}
if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1) {
  console.error("clean-orphan-originals: BATCH_SIZE must be a positive integer");
  process.exit(1);
}
// RETENTION_DAYS=0 deletes metadata-less originals uploaded milliseconds ago —
// inside the live presign→complete window. Guard production deletes behind an
// explicit opt-in; dry-run and tests are unaffected.
if (!DRY_RUN && RETENTION_DAYS === 0 && process.env.ALLOW_RETENTION_ZERO !== "1") {
  console.error(
    "clean-orphan-originals: RETENTION_DAYS=0 with DRY_RUN=0 can delete in-flight uploads; set ALLOW_RETENTION_ZERO=1 to confirm",
  );
  process.exit(1);
}

function baseEndpoint() {
  if (R2_ENDPOINT) return R2_ENDPOINT;
  return `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function client() {
  return new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

/**
 * List up to `maxKeys` original/ objects older than the retention window.
 * Returns { candidates, truncated } where each candidate carries key, size,
 * lastModified, and whether completion metadata is present (it must be absent).
 */
async function listOrphanCandidates({ maxKeys, cutoffMs }) {
  const aws = client();
  const candidates = [];
  let cursor;
  let truncated = false;
  do {
    const url = new URL(`${baseEndpoint()}/${R2_BUCKET_NAME}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", "original/");
    url.searchParams.set("max-keys", String(Math.min(1000, maxKeys - candidates.length)));
    if (cursor) url.searchParams.set("continuation-token", cursor);
    const res = await aws.fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      throw new Error(`ListObjectsV2 failed with ${res.status}: ${await res.text().then((t) => t.slice(0, 300))}`);
    }
    const xml = await res.text();
    const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => m[1]);
    for (const entry of contents) {
      const key = decodeURIComponent(entry.match(/<Key>([^<]+)<\/Key>/)?.[1] ?? "");
      const lastModified = Date.parse(entry.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? "");
      if (!key || Number.isNaN(lastModified)) continue;
      if (lastModified > cutoffMs) continue; // younger than the retention window
      // Head the candidate to inspect completion metadata. Only objects WITHOUT
      // x-amz-meta-targettype are abandoned (complete() always sets it).
      const head = await aws.fetch(`${baseEndpoint()}/${R2_BUCKET_NAME}/${key}`, {
        method: "HEAD",
        redirect: "manual",
      });
      if (head.status !== 200) {
        // Vanished between LIST and HEAD, or transient storage error: skip this
        // run — the next run re-evaluates. Never delete on uncertain state.
        continue;
      }
      const targetType = head.headers.get("x-amz-meta-targettype");
      if (!targetType) {
        candidates.push({ key, size: Number(head.headers.get("content-length") ?? 0), lastModified });
      }
      if (candidates.length >= maxKeys) {
        truncated = true;
        break;
      }
    }
    cursor = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!cursor) break;
  } while (candidates.length < maxKeys);
  return { candidates, truncated };
}

/** Delete in bounded batches; returns per-batch results. */
async function deleteKeys(keys) {
  const aws = client();
  const results = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const deleted = [];
    const failed = [];
    for (const key of batch) {
      try {
        const res = await aws.fetch(`${baseEndpoint()}/${R2_BUCKET_NAME}/${key}`, { method: "DELETE" });
        if (res.ok || res.status === 404) deleted.push(key);
        else failed.push({ key, status: res.status });
      } catch (e) {
        failed.push({ key, error: e instanceof Error ? e.message : String(e) });
      }
    }
    results.push({ batch: Math.floor(i / BATCH_SIZE) + 1, requested: batch.length, deleted: deleted.length, failed });
    console.log(JSON.stringify({ op: DRY_RUN ? "dry-run" : "delete", ...results.at(-1) }));
  }
  return results;
}

async function main() {
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  console.log(
    JSON.stringify({
      op: "start",
      dryRun: DRY_RUN,
      retentionDays: RETENTION_DAYS,
      maxObjects: MAX_OBJECTS,
      batchSize: BATCH_SIZE,
      cutoff: new Date(cutoffMs).toISOString(),
    }),
  );

  const { candidates, truncated } = await listOrphanCandidates({ maxKeys: MAX_OBJECTS, cutoffMs });
  console.log(
    JSON.stringify({
      op: "scan",
      orphanCandidates: candidates.length,
      truncated,
      totalBytes: candidates.reduce((sum, c) => sum + c.size, 0),
    }),
  );
  if (candidates.length === 0) {
    console.log(JSON.stringify({ op: "done", deleted: 0 }));
    return;
  }

  if (DRY_RUN) {
    for (const c of candidates) {
      console.log(JSON.stringify({ op: "would-delete", key: c.key, size: c.size, ageDays: Math.floor((Date.now() - c.lastModified) / 86_400_000) }));
    }
    console.log(JSON.stringify({ op: "done", deleted: 0, wouldDelete: candidates.length, dryRun: true }));
    return;
  }

  const results = await deleteKeys(candidates.map((c) => c.key));
  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed.length, 0);
  console.log(JSON.stringify({ op: "done", deleted: totalDeleted, failed: totalFailed }));
  // Partial failures are visible but not fatal: the next run retries the rest
  // (idempotent). Operational failures above already exit non-zero via throw.
  if (totalFailed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("clean-orphan-originals failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
