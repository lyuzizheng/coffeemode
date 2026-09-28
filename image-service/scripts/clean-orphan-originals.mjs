#!/usr/bin/env node
/**
 * R2 orphan-original + stale-staging cleanup (issue #158, hardened
 * BRAWUKA-400, extended BRAWUKA-699 and BRAWUKA-730) — safe, reference-aware,
 * dry-run first.
 *
 * Orphan = stale-marker `original/{uuid}.webp` (markerless or still
 * `provision`: uploaded, never attached) older than RETENTION_DAYS and
 * absent from the live-keys export (`web/scripts/export-live-image-keys.mjs`:
 * live `cafes.gallery` / live `checkins.photos`; BRAWUKA-699 made it
 * live-only so tombstone-only keys converge here). Post-commit attach
 * (BRAWUKA-400) re-marks live originals to `checkin`; a referenced stale
 * marker (attach retry outstanding) is reported, never deleted.
 *
 * Variant co-delete (BRAWUKA-699): an orphan original deletes with its
 * `card/` + `thumbnail/` siblings — siblings first, original last, so a
 * failed sibling keeps the original as the retry anchor for the next run.
 * A missing sibling is success (404-tolerant).
 *
 * Final-marked reconciliation (BRAWUKA-725): a `checkin`/`cafe` marker
 * proves attachment, not liveness — once the row is tombstoned and the
 * post-commit delete leg failed (storage outage), the marker survives while
 * no live row references the key. Those reconcile against a COMPLETE
 * live-keys export (BRAWUKA-757): absent from a valid export → deleted with
 * their siblings (stage `final`); present → kept silently; no export, or an
 * export that is empty/malformed/truncated → held back (`finalHeld`).
 * ALLOW_EMPTY_LIVE_KEYS never unlocks final-marked originals.
 *
 * Staged uploads (BRAWUKA-730): `staging/` holds the browser-written raw
 * uploads. They are never published and never referenced by a DB row, so age
 * alone makes them garbage — the scan lists them, filters by the same
 * RETENTION_DAYS window (far beyond the 1-hour upload-intent window a retry
 * needs), and deletes them without a HEAD, a marker, or the live-keys export.
 * The staged object cannot hide behind the live-keys guard either: the export
 * lists `original/` keys only.
 *
 * Safety properties:
 *   - DRY_RUN=1 (default) lists and reports without deleting.
 *   - LIVE_KEYS_FILE (optional): path to the export above. A non-empty file
 *     must be a COMPLETE export artifact (BRAWUKA-757): one strict
 *     `original/{uuid}.webp` key per line, closed by a final
 *     `# live-keys v1 total=<N>` line whose count matches the key lines.
 *     Anything else — a malformed line, a truncated prefix (trailer absent),
 *     a count mismatch, content after the trailer — refuses the run before
 *     any listing or delete: a partial write must never authorize
 *     deletions. Referenced keys are never deleted; dry-run reports them as
 *     `would-keep … reason:"referenced"` next to `would-delete` true orphans.
 *     Without the file the script keeps marker-based behavior for
 *     markerless/provision candidates (reason:"unverified") and holds every
 *     final-marked original back — schedule the export in production (see
 *     docs/agent/pending-user-actions.md §6). A set-but-empty export with
 *     DRY_RUN=0 is refused unless ALLOW_EMPTY_LIVE_KEYS=1: an empty file
 *     means the export failed or was truncated, not "zero live keys"
 *     (BRAWUKA-632).
 *   - Cursor-paginated listing (bounded by MAX_OBJECTS per scanned prefix —
 *     `original/` and `staging/` each get a budget) and batched deletes
 *     (BATCH_SIZE); idempotent — re-running skips already-deleted keys.
 *   - Deletion is scoped to the scanned prefix: a key a LIST returns outside
 *     it is never charged against the budget nor deleted.
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
import { pathToFileURL } from "node:url";
import { deleteOne, headObject, listPrefixEntries, r2Env } from "./lib/r2-store.mjs";
import { classifyOriginal, parseLiveKeys, variantKeysForOriginal } from "./orphan-classify.mjs";

const LIVE_KEYS_FILE = process.env.LIVE_KEYS_FILE?.trim() || "";

const DRY_RUN = process.env.DRY_RUN !== "0";
const RETENTION_DAYS = Number.parseInt(process.env.RETENTION_DAYS ?? "7", 10);
const MAX_OBJECTS = Number.parseInt(process.env.MAX_OBJECTS ?? "1000", 10);
const BATCH_SIZE = Math.min(Number.parseInt(process.env.BATCH_SIZE ?? "100", 10), 1000);

// Scanned prefixes (BRAWUKA-730): published originals need the marker +
// live-keys analysis, browser-written staged uploads do not. Every scan
// deletes only keys under its own prefix.
const ORIGINAL_PREFIX = "original/";
const STAGING_PREFIX = "staging/";

/**
 * DB-referenced live keys (BRAWUKA-400): a complete export artifact — one
 * strict `original/...` key per line, closed by the exporter's completeness
 * trailer (BRAWUKA-757). An existing-but-empty export (BRAWUKA-632) is a
 * failed/truncated export, never "zero live keys" — production deletes
 * refuse it unless overridden. A non-empty file that is not a complete
 * artifact refuses the run outright: a malformed or partially written file
 * must never authorize deletions.
 */
function loadLiveKeys() {
  if (!LIVE_KEYS_FILE) return null;
  let raw;
  try {
    raw = readFileSync(LIVE_KEYS_FILE, "utf8");
  } catch (err) {
    console.error(
      `clean-orphan-originals: cannot read LIVE_KEYS_FILE ${LIVE_KEYS_FILE}: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
  if (raw === "") return new Set();
  try {
    return parseLiveKeys(raw);
  } catch (err) {
    console.error(
      `clean-orphan-originals: LIVE_KEYS_FILE ${LIVE_KEYS_FILE} is not a complete export (${err instanceof Error ? err.message : err}); refusing to delete — regenerate it with web/scripts/export-live-image-keys.mjs (BRAWUKA-757)`,
    );
    process.exit(1);
  }
}

// Top-level env reads feed `main()`; missing credentials fail fast in `validateConfig()`.
function validateConfig() {
  if (!r2Env.accessKeyId || !r2Env.secretAccessKey || !r2Env.bucketName || (!r2Env.endpoint && !r2Env.accountId)) {
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

/**
 * Classify one listed `original/` entry. Returns null for young, gone, or
 * silently-kept entries; otherwise the bucket (`orphan` / `protected` /
 * `held`) plus the candidate record. The gate itself lives in
 * `orphan-classify.mjs` (`classifyOriginal`): markerless/provision keep the
 * marker-based contract; final-marked originals reconcile against a complete
 * export only — held when no export can prove them unreferenced.
 */
async function classifyOriginalCandidate({ entry, cutoffMs, liveKeys }) {
  if (entry.lastModified === null || entry.lastModified > cutoffMs) return null;
  // Head the candidate: completion metadata classifies it. Vanished between
  // LIST and HEAD, or transient storage error: skip this run — the next run
  // re-evaluates. Never delete on uncertain state.
  const head = await headObject(entry.key);
  if (head.status !== 200) return null;
  const verdict = classifyOriginal({
    key: entry.key,
    size: Number(head.headers.get("content-length") ?? 0),
    lastModified: entry.lastModified,
    targetType: head.headers.get("x-amz-meta-targettype"),
    liveKeys,
  });
  if (verdict.action === "orphan") return { bucket: "orphan", candidate: verdict.candidate };
  if (verdict.action === "protected") return { bucket: "protected", candidate: verdict.candidate };
  if (verdict.action === "held") return { bucket: "held" };
  return null; // kept: live-referenced final-marked original, silent
}

/**
 * Scan up to `maxKeys` listed `original/` objects (BRAWUKA-592: the bound
 * covers scan work — every listed entry consumes budget, so one run does at
 * most `maxKeys` HEADs). Returns { orphans, protectedRefs, truncated,
 * finalHeld }: unreferenced candidates vs. stale-marker + DB-referenced
 * (missing or failed attach leg — reported, never deleted); `finalHeld`
 * counts final-marked originals held back because no complete export could
 * verify them (BRAWUKA-725 fail-closed).
 */
async function listOrphanCandidates({ maxKeys, cutoffMs, liveKeys }) {
  const orphans = [];
  const protectedRefs = [];
  let finalHeld = 0;
  const { entries, truncated } = await listPrefixEntries({ prefix: ORIGINAL_PREFIX, maxEntries: maxKeys });
  for (const entry of entries) {
    const classified = await classifyOriginalCandidate({ entry, cutoffMs, liveKeys });
    if (!classified) continue;
    if (classified.bucket === "orphan") orphans.push(classified.candidate);
    else if (classified.bucket === "protected") protectedRefs.push(classified.candidate);
    else finalHeld += 1;
  }
  return { orphans, protectedRefs, truncated, finalHeld };
}

/**
 * Stale staged uploads (BRAWUKA-730): every `staging/` object older than the
 * retention window is garbage — the browser wrote it, nothing published or
 * referenced it, and the 1-hour upload-intent window (the only consumer, for
 * a retry) closed long before RETENTION_DAYS. No HEAD, no marker, no
 * live-keys membership: age alone decides.
 */
async function listStaleStaging({ maxKeys, cutoffMs }) {
  const { entries, truncated } = await listPrefixEntries({ prefix: STAGING_PREFIX, maxEntries: maxKeys });
  const stale = entries.filter((entry) => entry.lastModified !== null && entry.lastModified <= cutoffMs);
  return { stale, truncated };
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
  const results = [];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const deleted = [];
    const failed = [];
    for (const key of batch) {
      let blocked = false;
      for (const sibling of variantKeysForOriginal(key)) {
        const failure = await deleteOne(sibling);
        if (failure) {
          failed.push(failure);
          blocked = true;
        } else deleted.push(sibling);
      }
      // The original is the retry anchor: only remove it when every sibling
      // succeeded, so a failed sibling is re-attempted on the next run.
      if (blocked) continue;
      const failure = await deleteOne(key);
      if (failure) failed.push(failure);
      else deleted.push(key);
    }
    results.push({ batch: Math.floor(i / BATCH_SIZE) + 1, requested: batch.length, deleted: deleted.length, failed });
    console.log(JSON.stringify({ op: DRY_RUN ? "dry-run" : "delete", ...results.at(-1) }));
  }
  return results;
}

/**
 * Dry-run output: every scanned candidate with the reason it would be kept or
 * deleted, nothing touched. `original/` candidates carry their size, stage,
 * verification and derived siblings; `staging/` candidates only their prefix —
 * age is the whole story there.
 */
function reportDryRun({ orphans, protectedRefs, staleStaging }) {
  const line = (op, candidate, extra) =>
    console.log(
      JSON.stringify({
        op,
        key: candidate.key,
        size: candidate.size,
        stage: candidate.stage,
        verification: candidate.verification,
        ageDays: Math.floor((Date.now() - candidate.lastModified) / 86_400_000),
        ...extra,
      }),
    );
  for (const candidate of orphans) {
    line("would-delete", candidate, { variants: variantKeysForOriginal(candidate.key) });
  }
  for (const candidate of protectedRefs) line("would-keep", candidate, { reason: "referenced" });
  for (const candidate of staleStaging) line("would-delete", candidate, { prefix: STAGING_PREFIX });
  console.log(
    JSON.stringify({
      op: "done",
      deleted: 0,
      wouldDelete: orphans.length,
      wouldKeep: protectedRefs.length,
      wouldDeleteStaging: staleStaging.length,
      dryRun: true,
    }),
  );
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
  const { stale: staleStaging, truncated: stagingTruncated } = await listStaleStaging({
    maxKeys: MAX_OBJECTS,
    cutoffMs,
  });
  console.log(
    JSON.stringify({
      op: "scan",
      orphanCandidates: orphans.length,
      protectedRefs: protectedRefs.length,
      stagingCandidates: staleStaging.length,
      finalHeld,
      truncated: truncated || stagingTruncated,
      totalBytes: orphans.reduce((sum, c) => sum + c.size, 0),
    }),
  );
  if (orphans.length === 0 && protectedRefs.length === 0 && staleStaging.length === 0) {
    console.log(JSON.stringify({ op: "done", deleted: 0 }));
    return;
  }

  // A stale marker that IS DB-referenced (attach leg missing/failed) is
  // reported as would-keep, never deleted (BRAWUKA-400).
  if (DRY_RUN) {
    reportDryRun({ orphans, protectedRefs, staleStaging });
    return;
  }

  const results = [
    ...(await deleteKeys(orphans.map((c) => c.key))),
    ...(await deleteKeys(staleStaging.map((c) => c.key))),
  ];
  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed.length, 0);
  const failedKeys = new Set(results.flatMap((r) => r.failed.map((f) => f.key)));
  console.log(
    JSON.stringify({
      op: "done",
      deleted: totalDeleted,
      failed: totalFailed,
      protectedRefs: protectedRefs.length,
      // Actual removals, not attempts: a failed delete keeps its key out.
      stagingDeleted: staleStaging.filter((c) => !failedKeys.has(c.key)).length,
    }),
  );
  // Partial failures exit 1 for visibility; the next run retries the rest
  // (idempotent). Operational failures above already throw.
  if (totalFailed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err) => {
    console.error("clean-orphan-originals failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
