#!/usr/bin/env node
/**
 * R2 orphan-original cleanup (issue #158, hardened BRAWUKA-400, extended
 * BRAWUKA-699) — safe, reference-aware, dry-run first.
 *
 * Orphan = stale-marker `original/{uuid}.webp` (markerless or still
 * `provision`: uploaded, never attached) older than RETENTION_DAYS and
 * absent from the live-keys export (`web/scripts/export-live-image-keys.mjs`:
 * live `cafes.gallery` / live `checkins.photos`; BRAWUKA-699 made it
 * live-only so tombstone-only keys converge here). Post-commit attach
 * (BRAWUKA-400) re-marks live originals to `checkin`; a referenced stale
 * marker (attach retry outstanding) is reported, never deleted.
 *
 * Final-marked originals (BRAWUKA-725): a `checkin`/`cafe` marker proves
 * attachment, not liveness — a tombstoned row plus a failed post-commit
 * delete leg (storage outage) leaves the marker behind with no live
 * reference, so the marker alone must never keep the key forever.
 * Final-marked originals reconcile against a NON-EMPTY live-keys export
 * only: absent from it → swept with its variants; present in it → kept
 * silently; no/empty export → held (counted as `finalHeld` in the scan
 * summary), never deleted. ALLOW_EMPTY_LIVE_KEYS does not extend to them.
 *
 * Variant co-delete (BRAWUKA-699): an orphan original deletes with its
 * `card/` + `thumbnail/` siblings — siblings first, original last, so a
 * failed sibling keeps the original as the retry anchor for the next run.
 * A missing sibling is success (404-tolerant).
 *
 * Safety properties:
 *   - DRY_RUN=1 (default) lists and reports without deleting.
 *   - LIVE_KEYS_FILE (optional): path to the export above, one key per line.
 *     Referenced keys are never deleted; dry-run reports them as
 *     `would-keep … reason:"referenced"` next to `would-delete` true orphans.
 *     Without the file the script keeps marker-based behavior and treats
 *     every markerless/provision candidate as unverified
 *     (reason:"unverified") — schedule the export in production (see
 *     docs/agent/pending-user-actions.md §6).
 *     A set-but-empty export with DRY_RUN=0 is refused unless
 *     ALLOW_EMPTY_LIVE_KEYS=1: an empty file means the export failed or was
 *     truncated, not "zero live keys" (BRAWUKA-632).
 *   - Cursor-paginated listing (bounded by MAX_OBJECTS per run) and batched
 *     deletes (BATCH_SIZE); idempotent — re-running skips already-deleted keys.
 *   - Structured JSON summary per batch + final counts; non-zero exit only on
 *     operational failure (listing/auth), not on "nothing to delete".
 *
 * Usage (VPS cron / GitHub schedule via #154; least-privilege R2 creds):
 *   DATABASE_URL=postgres://... node web/scripts/export-live-image-keys.mjs > /tmp/live-keys.txt
 *   R2_ENDPOINT=https://{account}.r2.cloudflarestorage.com \
 *   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=... \
 *   LIVE_KEYS_FILE=/tmp/live-keys.txt \
 *   DRY_RUN=1 RETENTION_DAYS=7 MAX_OBJECTS=1000 node clean-orphan-originals.mjs
 */

import { readFileSync, realpathSync } from "node:fs";
import { AwsClient } from "aws4fetch";
import { pathToFileURL } from "node:url";
import { classifyOriginal, unescapeXml, variantKeysForOriginal } from "./orphan-classify.mjs";

const R2_ENDPOINT = process.env.R2_ENDPOINT?.replace(/\/+$/, "");
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const LIVE_KEYS_FILE = process.env.LIVE_KEYS_FILE?.trim() || "";

const DRY_RUN = process.env.DRY_RUN !== "0";
const RETENTION_DAYS = Number.parseInt(process.env.RETENTION_DAYS ?? "7", 10);
const MAX_OBJECTS = Number.parseInt(process.env.MAX_OBJECTS ?? "1000", 10);
const BATCH_SIZE = Math.min(Number.parseInt(process.env.BATCH_SIZE ?? "100", 10), 1000);

/**
 * DB-referenced live keys (BRAWUKA-400): one `original/...` key per line.
 * An existing-but-empty export (BRAWUKA-632) is a failed/truncated export,
 * never "zero live keys" — production deletes refuse it unless overridden.
 */
function loadLiveKeys() {
  if (!LIVE_KEYS_FILE) return null;
  try {
    const keys = new Set();
    for (const line of readFileSync(LIVE_KEYS_FILE, "utf8").split("\n")) {
      const key = line.trim();
      if (key.startsWith("original/")) keys.add(key);
    }
    return keys;
  } catch (err) {
    console.error(
      `clean-orphan-originals: cannot read LIVE_KEYS_FILE ${LIVE_KEYS_FILE}: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

// Top-level env reads feed `main()`; missing credentials fail fast in `validateConfig()`.
function validateConfig() {
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
  // RETENTION_DAYS=0 with deletes needs explicit opt-in (live upload window).
  if (!DRY_RUN && RETENTION_DAYS === 0 && process.env.ALLOW_RETENTION_ZERO !== "1") {
    console.error(
      "clean-orphan-originals: RETENTION_DAYS=0 with DRY_RUN=0 can delete in-flight uploads; set ALLOW_RETENTION_ZERO=1 to confirm",
    );
    process.exit(1);
  }
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
 * Scan at most `maxKeys` listed `original/` objects (BRAWUKA-592: the bound
 * covers scan work — every listed entry consumes budget, so one run does at
 * most `maxKeys` HEADs). Returns { orphans, protectedRefs, truncated,
 * finalHeld }: unreferenced candidates vs. stale-marker + DB-referenced
 * (missing or failed attach leg — reported, never deleted); `finalHeld`
 * counts final-marked originals this run held back because no non-empty
 * export could verify them (BRAWUKA-725 fail-closed). Entry verification:
 * `referenced` (in LIVE_KEYS_FILE), `not-referenced` (checked, absent),
 * `unverified` (no file given). See `classifyOriginal` for the full gate.
 */
async function listOrphanCandidates({ maxKeys, cutoffMs, liveKeys }) {
  const aws = client();
  const orphans = [];
  const protectedRefs = [];
  let finalHeld = 0;
  let cursor;
  let truncated = false;
  let scanned = 0;
  let lastPageTruncated = false;
  do {
    const url = new URL(`${baseEndpoint()}/${R2_BUCKET_NAME}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", "original/");
    url.searchParams.set("max-keys", String(Math.min(1000, maxKeys - scanned)));
    if (cursor) url.searchParams.set("continuation-token", cursor);
    const res = await aws.fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      throw new Error(`ListObjectsV2 failed with ${res.status}: ${await res.text().then((t) => t.slice(0, 300))}`);
    }
    const xml = await res.text();
    lastPageTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => m[1]);
    for (let i = 0; i < contents.length; i += 1) {
      if (scanned >= maxKeys) {
        truncated = true;
        break;
      }
      const entry = contents[i];
      const rawKey = entry.match(/<Key>([^<]+)<\/Key>/)?.[1] ?? "";
      if (!rawKey) continue;
      const key = unescapeXml(rawKey);
      if (!key) continue;
      scanned += 1;
      const lastModified = Date.parse(entry.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? "");
      if (Number.isNaN(lastModified)) continue;
      if (lastModified > cutoffMs) continue; // younger than the retention window
      // Head the candidate: completion metadata classifies it (BRAWUKA-725).
      // Encode the key (BRAWUKA-592): a raw `&` or `%` would split the REST
      // path or hit the wrong object.
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      const head = await aws.fetch(`${baseEndpoint()}/${R2_BUCKET_NAME}/${encodedKey}`, {
        method: "HEAD",
        redirect: "manual",
      });
      if (head.status !== 200) {
        // Vanished between LIST and HEAD, or transient storage error: skip this
        // run — the next run re-evaluates. Never delete on uncertain state.
        continue;
      }
      // Gate (classifyOriginal): markerless/provision keep the marker-based
      // contract; final-marked originals reconcile against a non-empty
      // export only — held when no export can prove them unreferenced.
      const verdict = classifyOriginal({
        key,
        size: Number(head.headers.get("content-length") ?? 0),
        lastModified,
        targetType: head.headers.get("x-amz-meta-targettype"),
        liveKeys,
      });
      if (verdict.action === "orphan") orphans.push(verdict.candidate);
      else if (verdict.action === "protected") protectedRefs.push(verdict.candidate);
      else if (verdict.action === "held") finalHeld += 1;
      if (scanned >= maxKeys) {
        // Budget covers scan work, not matches: stop even when this entry
        // was young or already completed. Report truncation only when
        // unprocessed entries remain on this page or further pages exist.
        const moreInPage = i + 1 < contents.length;
        const morePages = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        if (moreInPage || morePages) truncated = true;
        break;
      }
    }
    if (truncated) break;
    cursor = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!cursor) break;
  } while (scanned < maxKeys);
  // Budget hit exactly on the last entry of the final processed page
  // (BRAWUKA-592 re-review P2): the in-loop `scanned >= maxKeys` check above
  // is skipped on `continue` paths (young, NaN-dated, failed HEAD), so the
  // report would claim a complete scan while a tail remains. Re-evaluate
  // here against the last page seen.
  if (!truncated && scanned >= maxKeys && lastPageTruncated) {
    truncated = true;
  }
  return { orphans, protectedRefs, truncated, finalHeld };
}

/**
 * Delete one S3 key; missing counts as success (404-tolerant, like
 * `/v1/images/delete` — a half-deleted retry must converge). Returns null
 * on success, a { key, … } failure entry otherwise.
 */
async function deleteOne(aws, key) {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  try {
    const res = await aws.fetch(`${baseEndpoint()}/${R2_BUCKET_NAME}/${encoded}`, { method: "DELETE" });
    // Benign: drain the body so the socket can be reused.
    await res.body?.cancel().catch(() => {});
    if (res.ok || res.status === 404) return null;
    return { key, status: res.status };
  } catch (e) {
    return { key, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Delete in bounded batches; returns per-batch results — each orphan
 * original deletes with its `card/` + `thumbnail/` siblings (up to 3N
 * deletes per N-orphan batch). Siblings go first and the original goes
 * last: a failed sibling leaves the original listed on the next run, which
 * re-derives the same siblings and converges all three. `deleted` counts
 * every removed key; `failed` carries per-key entries for both.
 */
async function deleteKeys(keys) {
  const aws = client();
  const results = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const deleted = [];
    const failed = [];
    for (const key of batch) {
      let blocked = false;
      for (const sibling of variantKeysForOriginal(key)) {
        const failure = await deleteOne(aws, sibling);
        if (failure) {
          failed.push(failure);
          blocked = true;
        } else deleted.push(sibling);
      }
      // The original is the retry anchor: only remove it when every sibling
      // succeeded, so a failed sibling is re-attempted on the next run.
      if (blocked) continue;
      const failure = await deleteOne(aws, key);
      if (failure) failed.push(failure);
      else deleted.push(key);
    }
    results.push({ batch: Math.floor(i / BATCH_SIZE) + 1, requested: batch.length, deleted: deleted.length, failed });
    console.log(JSON.stringify({ op: DRY_RUN ? "dry-run" : "delete", ...results.at(-1) }));
  }
  return results;
}

async function main() {
  validateConfig();
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const liveKeys = loadLiveKeys();
  // A set-but-empty export (BRAWUKA-632) is a failed/truncated export: refuse.
  if (LIVE_KEYS_FILE && liveKeys.size === 0 && !DRY_RUN && process.env.ALLOW_EMPTY_LIVE_KEYS !== "1") {
    console.error(
      `clean-orphan-originals: LIVE_KEYS_FILE ${LIVE_KEYS_FILE} loaded 0 keys with DRY_RUN=0; refusing to delete (export may have failed or been truncated); set ALLOW_EMPTY_LIVE_KEYS=1 to confirm the bucket is truly unreferenced`,
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      op: "start",
      dryRun: DRY_RUN,
      retentionDays: RETENTION_DAYS,
      maxObjects: MAX_OBJECTS,
      batchSize: BATCH_SIZE,
      cutoff: new Date(cutoffMs).toISOString(),
      liveKeys: liveKeys ? liveKeys.size : null,
    }),
  );

  const { orphans, protectedRefs, truncated, finalHeld } = await listOrphanCandidates({
    maxKeys: MAX_OBJECTS,
    cutoffMs,
    liveKeys,
  });
  console.log(
    JSON.stringify({
      op: "scan",
      orphanCandidates: orphans.length,
      protectedRefs: protectedRefs.length,
      finalHeld,
      truncated,
      totalBytes: orphans.reduce((sum, c) => sum + c.size, 0),
    }),
  );
  if (orphans.length === 0 && protectedRefs.length === 0) {
    console.log(JSON.stringify({ op: "done", deleted: 0 }));
    return;
  }

  // A stale marker that IS DB-referenced (attach leg missing/failed) is
  // reported as would-keep, never deleted (BRAWUKA-400).
  const ageDays = (lastModified) => Math.floor((Date.now() - lastModified) / 86_400_000);
  if (DRY_RUN) {
    const report = (op, c, extra) =>
      console.log(
        JSON.stringify({
          op,
          key: c.key,
          size: c.size,
          stage: c.stage,
          verification: c.verification,
          ageDays: ageDays(c.lastModified),
          ...extra,
        }),
      );
    for (const c of orphans) report("would-delete", c, { variants: variantKeysForOriginal(c.key) });
    for (const c of protectedRefs) report("would-keep", c, { reason: "referenced" });
    console.log(
      JSON.stringify({
        op: "done",
        deleted: 0,
        wouldDelete: orphans.length,
        wouldKeep: protectedRefs.length,
        dryRun: true,
      }),
    );
    return;
  }

  const results = await deleteKeys(orphans.map((c) => c.key));
  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed.length, 0);
  console.log(
    JSON.stringify({
      op: "done",
      deleted: totalDeleted,
      failed: totalFailed,
      protectedRefs: protectedRefs.length,
    }),
  );
  // Partial failures exit 1 for visibility; the next run retries the rest
  // (idempotent). Operational failures above already throw.
  if (totalFailed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err) => {
    console.error("clean-orphan-originals failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
