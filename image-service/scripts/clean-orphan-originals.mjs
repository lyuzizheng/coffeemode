#!/usr/bin/env node
/**
 * R2 orphan-original cleanup (issue #158, hardened BRAWUKA-400) — safe,
 * reference-aware, dry-run first.
 *
 * Orphan definition (cannot match a completed/live gallery original):
 *   an `original/{uuid}.webp` object older than RETENTION_DAYS whose stored
 *   metadata is markerless or still `provision` (uploaded for processing but
 *   never attached) AND whose key is absent from the live-keys export
 *   (`web/scripts/export-live-image-keys.mjs`: every `original/` key still
 *   referenced by `cafes.gallery` / `checkins.photos`). Post-commit attach
 *   (BRAWUKA-400) re-marks live originals to `checkin`, but the reference
 *   check stays authoritative: a `provision`-marked object that IS referenced
 *   (attach retry outstanding) is reported, never deleted.
 *
 * Safety properties:
 *   - DRY_RUN=1 (default) lists and reports without deleting.
 *   - LIVE_KEYS_FILE (optional): path to the export above, one key per line.
 *     Referenced keys are never deleted; dry-run reports them as
 *     `would-keep … reason:"referenced"` next to `would-delete` true orphans.
 *     Without the file the script keeps marker-based behavior and treats
 *     every candidate as unverified (reason:"unverified") — schedule the
 *     export in production (see docs/agent/pending-user-actions.md §6).
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
 * DB-referenced live keys (BRAWUKA-400): one `original/...` key per line from
 * `web/scripts/export-live-image-keys.mjs`. Absent file keeps the
 * marker-based behavior and marks every candidate unverified.
 *
 * An existing-but-empty export (BRAWUKA-632) is NOT "zero live keys": a failed
 * or truncated `export-live-image-keys.mjs` run (disk full, killed mid-write,
 * `> file` truncating before the query runs) produces exactly such a file,
 * and every stale-marker key would then look deletable. Production deletes
 * with an empty export are refused unless ALLOW_EMPTY_LIVE_KEYS=1.
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
  // RETENTION_DAYS=0 deletes metadata-less originals uploaded milliseconds ago —
  // inside the live presign→complete window. Guard production deletes behind an
  // explicit opt-in; dry-run and tests are unaffected.
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
 * Decode an S3 ListObjectsV2 `<Key>` value (BRAWUKA-592).
 *
 * The script does not request `encoding-type=url`, so keys arrive XML-escaped,
 * not percent-encoded — `decodeURIComponent` is the wrong decoder: it leaves
 * `&amp;` unresolved and throws `URIError` on keys containing a bare `%`,
 * failing the whole run. Decode the five predefined XML entities plus numeric
 * character references in a single pass, so `&amp;lt;` (a literal `&lt;` in
 * the key) is not double-decoded to `<`.
 */
function unescapeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#[xX]([0-9a-fA-F]+);/g, (m, named, dec, hex) => {
    if (named) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named];
    const cp = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    if (!Number.isSafeInteger(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
    return String.fromCodePoint(cp);
  });
}

/**
 * Scan at most `maxKeys` listed `original/` objects per run (BRAWUKA-592:
 * the bound covers scan work, not matches — every listed entry consumes
 * budget even when young or already completed, so one run does at most
 * `maxKeys` HEADs).
 * Returns { orphans, protectedRefs, truncated }: `orphans` are deletable
 * (stale marker + not DB-referenced), `protectedRefs` are stale-marker
 * objects that ARE DB-referenced (missing/failed attach leg) — reported,
 * never deleted. Each entry carries key, size, lastModified, stage, and
 * verification (`referenced` when the key IS in LIVE_KEYS_FILE,
 * `not-referenced` when the file was checked and the key is absent from it,
 * `unverified` when no file was given).
 */
async function listOrphanCandidates({ maxKeys, cutoffMs, liveKeys }) {
  const aws = client();
  const orphans = [];
  const protectedRefs = [];
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
      // Head the candidate to inspect completion metadata. Only objects WITHOUT
      // x-amz-meta-targettype are abandoned (complete() always sets it).
      // Encode the listed key (BRAWUKA-592): a raw `&` or `%` in the name
      // would otherwise split the REST path or decode to the wrong object —
      // HEADing/DELETEing the wrong object, in the worst case a live one.
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
      // Orphan definition (issue #158, BRAWUKA-400): an original is abandoned
      // when it has NO completion marker (pre-#158 or direct-write residue) OR
      // is still in the "provision" stage (uploaded but never attached) — AND
      // its key is absent from the DB live-keys export. A stale marker that IS
      // referenced means the attach leg never ran or failed: protected, never
      // deleted. Live gallery originals carry targetType=cafe|checkin and are
      // never matched.
      const targetType = head.headers.get("x-amz-meta-targettype");
      if (!targetType || targetType === "provision") {
        // Label AFTER the membership check (BRAWUKA-592): `referenced` is
        // reserved for stale-marker keys that ARE in LIVE_KEYS_FILE
        // (protected, never deleted); checked-but-absent keys are
        // `not-referenced`; no file means `unverified`.
        const referenced = liveKeys?.has(key) ?? false;
        const candidate = {
          key,
          size: Number(head.headers.get("content-length") ?? 0),
          lastModified,
          stage: targetType === "provision" ? "provision" : "markerless",
          verification: liveKeys ? (referenced ? "referenced" : "not-referenced") : "unverified",
        };
        if (referenced) protectedRefs.push(candidate);
        else orphans.push(candidate);
      }
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
  return { orphans, protectedRefs, truncated };
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
        const res = await aws.fetch(`${baseEndpoint()}/${R2_BUCKET_NAME}/${key.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
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
  validateConfig();
  const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const liveKeys = loadLiveKeys();
  // A set-but-empty export (BRAWUKA-632) is a failed/truncated export, not
  // "zero live keys": every stale-marker key would look deletable. Refuse
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

  const { orphans, protectedRefs, truncated } = await listOrphanCandidates({
    maxKeys: MAX_OBJECTS,
    cutoffMs,
    liveKeys,
  });
  console.log(
    JSON.stringify({
      op: "scan",
      orphanCandidates: orphans.length,
      protectedRefs: protectedRefs.length,
      truncated,
      totalBytes: orphans.reduce((sum, c) => sum + c.size, 0),
    }),
  );
  if (orphans.length === 0 && protectedRefs.length === 0) {
    console.log(JSON.stringify({ op: "done", deleted: 0 }));
    return;
  }

  // A stale marker that IS DB-referenced means the attach leg never ran or
  // failed (BRAWUKA-400): true orphans vs. missing-attach originals stay
  // distinguishable in every dry-run, and protected keys are never deleted.
  const ageDays = (lastModified) => Math.floor((Date.now() - lastModified) / 86_400_000);
  if (DRY_RUN) {
    for (const c of orphans) {
      console.log(
        JSON.stringify({
          op: "would-delete",
          key: c.key,
          size: c.size,
          stage: c.stage,
          verification: c.verification,
          ageDays: ageDays(c.lastModified),
        }),
      );
    }
    for (const c of protectedRefs) {
      console.log(
        JSON.stringify({
          op: "would-keep",
          key: c.key,
          size: c.size,
          stage: c.stage,
          verification: c.verification,
          reason: "referenced",
          ageDays: ageDays(c.lastModified),
        }),
      );
    }
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
  // Partial failures are visible but not fatal: the next run retries the rest
  // (idempotent). Operational failures above already exit non-zero via throw.
  if (totalFailed > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((err) => {
    console.error("clean-orphan-originals failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
