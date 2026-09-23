/**
 * @vitest-environment node
 * Real MinIO integration — orphan-original cleanup script (issue #158,
 * hardened BRAWUKA-400).
 *
 * Stacked on the #156 storage suite: same local MinIO stack and TEST_R2_* env
 * isolation. Runs image-service/scripts/clean-orphan-originals.mjs as a child
 * process against seeded objects:
 *
 *   - abandoned: original/ without completion metadata, older than retention → deleted
 *   - completed: original/ WITH x-amz-meta-targettype (live gallery original) → kept
 *   - young abandoned: no metadata but inside the retention window → kept
 *   - dry-run (default): reports would-delete without deleting
 *   - reference-aware (BRAWUKA-400): a stale-marker original whose key IS in
 *     LIVE_KEYS_FILE reports would-keep reason:"referenced", never deleted —
 *     even with DRY_RUN=0
 *   - idempotent: second run deletes nothing
 *
 * Requires:
 *   docker compose up -d --wait postgres minio && docker compose run --rm minio-init
 *   RUN_INTEGRATION=1 npm run test:integration:images
 */

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  R2_ACCESS_KEY_ID,
  R2_CLEANUP_BUCKET_NAME as R2_BUCKET_NAME,
  R2_ENDPOINT,
  R2_SECRET_ACCESS_KEY,
  deleteObject as r2DeleteObject,
  minioReachable,
  objectExists as r2ObjectExists,
  putObject as r2PutObject,
  r2Client,
} from "../helpers/r2";

// Storage suites never touch the rate limiter (in-memory only, BRAWUKA-378).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeCleanup = RUN_INTEGRATION ? describe : describe.skip;

const IMAGE_SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../image-service",
);

let minioUp = false;
let currentBucket = "";
const createdKeys = new Set<string>();
const cleanupErrors: string[] = [];

async function createTestBucket(): Promise<string> {
  const bucket = `test-orphan-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = `${R2_ENDPOINT.replace(/\/+$/, "")}/${bucket}`;
  const res = await r2Client().fetch(url, { method: "PUT" });
  if (![200, 409].includes(res.status)) {
    throw new Error(`bucket create failed with ${res.status}`);
  }
  return bucket;
}

async function deleteTestBucket(bucket: string): Promise<void> {
  const url = `${R2_ENDPOINT.replace(/\/+$/, "")}/${bucket}`;
  try {
    const res = await r2Client().fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404 && res.status !== 204) {
      cleanupErrors.push(`DELETE bucket ${bucket} failed with HTTP ${res.status}`);
    }
  } catch (e) {
    cleanupErrors.push(`DELETE bucket ${bucket} threw ${(e as Error).message}`);
  }
}

async function putObject(key: string, body: Uint8Array, metadata?: Record<string, string>): Promise<void> {
  await r2PutObject(key, body, metadata, currentBucket);
  // r2PutObject throws on failure (unlike original expect); preserve createdKeys tracking.
  createdKeys.add(key);
}

async function objectExists(key: string): Promise<boolean> {
  return r2ObjectExists(key, currentBucket);
}

async function deleteObject(key: string): Promise<void> {
  try {
    await r2DeleteObject(key, currentBucket);
    createdKeys.delete(key);
  } catch (e) {
    cleanupErrors.push(`DELETE ${key} threw ${(e as Error).message}`);
    createdKeys.delete(key);
  }
}

interface RunResult {
  status: number;
  stdout: string;
}

/** Run the cleanup script as the cron would. `env` overrides script defaults. */
function runCleanup(env: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync("node", ["scripts/clean-orphan-originals.mjs"], {
      cwd: IMAGE_SERVICE_ROOT,
      env: {
        ...process.env,
        TEST_R2_ACCESS_KEY_ID: undefined,
        R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY,
        R2_BUCKET_NAME: currentBucket || R2_BUCKET_NAME,
        R2_ENDPOINT,
        ...env,
      } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "" };
  }
}

function seedOriginal(key: string, metadata?: Record<string, string>): Promise<void> {
  return putObject(key, new Uint8Array(Buffer.alloc(64, 0x61)), metadata);
}

describeCleanup("integration — orphan-original cleanup (issue #158)", () => {
  beforeAll(async () => {
    minioUp = await minioReachable();
    if (!minioUp) {
      throw new Error(
        `MinIO is not reachable at ${R2_ENDPOINT}. Orphan cleanup integration tests require a running MinIO instance (docker compose up -d --wait minio && docker compose run --rm minio-init).`,
      );
    }
  });

  beforeEach(async () => {
    currentBucket = await createTestBucket();
    createdKeys.clear();
  });

  afterEach(async () => {
    if (!currentBucket) return;
    for (const key of [...createdKeys]) {
      await deleteObject(key);
    }
    await deleteTestBucket(currentBucket);
    currentBucket = "";
  });

  afterAll(async () => {
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors.map((m) => new Error(m)), "cleanup failures");
  });

  it("dry-run reports abandoned originals without deleting them", async () => {
    const abandoned = `original/${randomUUID()}.webp`;
    const provisionStage = `original/${randomUUID()}.webp`;
    const completed = `original/${randomUUID()}.webp`;
    await seedOriginal(abandoned);
    await seedOriginal(provisionStage, { targettype: "provision", targetid: provisionStage.split("/")[1].replace(".webp", ""), userid: "u1" });
    await seedOriginal(completed, { targettype: "cafe", targetid: randomUUID(), userid: "u1" });

    const result = runCleanup({ DRY_RUN: "1", RETENTION_DAYS: "0", MAX_OBJECTS: "100" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"op":"would-delete"');
    expect(result.stdout).toContain(abandoned);
    // Provision-stage originals never attached → abandoned past retention.
    expect(result.stdout).toContain(provisionStage);
    expect(result.stdout).not.toContain(`"key":"${completed}"`);
    // Dry-run must not delete.
    expect(await objectExists(abandoned)).toBe(true);
    expect(await objectExists(completed)).toBe(true);
  });

  it("deletes only metadata-less originals; completed originals survive", async () => {
    const abandoned = `original/${randomUUID()}.webp`;
    const provisionStage = `original/${randomUUID()}.webp`;
    const completed = `original/${randomUUID()}.webp`;
    await seedOriginal(abandoned);
    await seedOriginal(provisionStage, { targettype: "provision", targetid: provisionStage.split("/")[1].replace(".webp", ""), userid: "u1" });
    await seedOriginal(completed, { targettype: "checkin", targetid: randomUUID(), userid: "u1" });

    const result = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"op":"done"');

    expect(await objectExists(abandoned)).toBe(false);
    expect(await objectExists(provisionStage)).toBe(false);
    expect(await objectExists(completed)).toBe(true);
    createdKeys.delete(abandoned); // already gone; skip afterAll re-delete
    createdKeys.delete(provisionStage);
  }, 20_000);

  it("keeps a stale-marker original listed in LIVE_KEYS_FILE: reported, never deleted (BRAWUKA-400)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const referenced = `original/${randomUUID()}.webp`;
    const orphan = `original/${randomUUID()}.webp`;
    await seedOriginal(referenced, { targettype: "provision", targetid: referenced.split("/")[1].replace(".webp", ""), userid: "u1" });
    await seedOriginal(orphan);
    const dir = mkdtempSync(`${tmpdir()}/live-keys-`);
    const file = `${dir}/live-keys.txt`;
    try {
      writeFileSync(file, `${referenced}\n`);
      const dry = runCleanup({ DRY_RUN: "1", RETENTION_DAYS: "0", MAX_OBJECTS: "100", LIVE_KEYS_FILE: file });
      expect(dry.status).toBe(0);
      // True orphan vs. missing-attach original stay distinguishable.
      expect(dry.stdout).toContain(`"key":"${orphan}"`);
      expect(dry.stdout).toContain('"op":"would-delete"');
      // Orphans checked against the live set are labeled not-referenced
      // (BRAWUKA-630); the referenced key itself carries
      // verification:"referenced" on its would-keep line (BRAWUKA-592) —
      // "referenced" is reserved for would-keep, never for would-delete.
      const dryLines = dry.stdout.split("\n").filter((l) => l.includes('"key":"'));
      const orphanLine = dryLines.find((l) => l.includes(`"key":"${orphan}"`));
      const referencedLine = dryLines.find((l) => l.includes(`"key":"${referenced}"`));
      expect(orphanLine).toContain('"op":"would-delete"');
      expect(orphanLine).toContain('"verification":"not-referenced"');
      expect(orphanLine).not.toContain('"verification":"referenced"');
      expect(referencedLine).toContain('"op":"would-keep"');
      expect(referencedLine).toContain('"verification":"referenced"');
      expect(dry.stdout).toContain(`"key":"${referenced}"`);
      expect(dry.stdout).toContain('"op":"would-keep"');
      expect(dry.stdout).toContain('"reason":"referenced"');
      expect(dry.stdout).not.toContain(`"would-delete","key":"${referenced}"`);

      const live = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1", LIVE_KEYS_FILE: file });
      expect(live.status).toBe(0);
      expect(await objectExists(referenced)).toBe(true);
      expect(await objectExists(orphan)).toBe(false);
      createdKeys.delete(orphan);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("refuses DRY_RUN=0 with a set-but-empty LIVE_KEYS_FILE unless ALLOW_EMPTY_LIVE_KEYS=1 (BRAWUKA-632)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const dir = mkdtempSync(`${tmpdir()}/live-keys-empty-`);
    const file = `${dir}/live-keys.txt`;
    try {
      writeFileSync(file, "");
      // Empty export + production deletes: refused before any listing.
      const refused = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "30", MAX_OBJECTS: "100", LIVE_KEYS_FILE: file });
      expect(refused.status).not.toBe(0);
      // Explicit opt-in passes the guard (nothing seeded, so nothing deleted).
      const optedIn = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "30", MAX_OBJECTS: "100", LIVE_KEYS_FILE: file, ALLOW_EMPTY_LIVE_KEYS: "1" });
      expect(optedIn.status).toBe(0);
      // Dry-run is unaffected either way.
      const dry = runCleanup({ DRY_RUN: "1", RETENTION_DAYS: "30", MAX_OBJECTS: "100", LIVE_KEYS_FILE: file });
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain('"liveKeys":0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("is idempotent: a second run deletes nothing more", async () => {
    const abandoned = `original/${randomUUID()}.webp`;
    await seedOriginal(abandoned);
    const first = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1" });
    expect(first.status).toBe(0);
    expect(await objectExists(abandoned)).toBe(false);
    createdKeys.delete(abandoned);

    const second = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1" });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('"orphanCandidates":0');
  }, 20_000);

  it("young metadata-less originals inside the retention window are kept", async () => {
    const young = `original/${randomUUID()}.webp`;
    await seedOriginal(young);
    const result = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "30", MAX_OBJECTS: "100" });
    expect(result.status).toBe(0);
    expect(await objectExists(young)).toBe(true);
  });

  it("empty-string targetType metadata counts as abandoned (falsy marker)", async () => {
    const malformed = `original/${randomUUID()}.webp`;
    await seedOriginal(malformed, { targettype: "" });
    const result = runCleanup({
      DRY_RUN: "0",
      RETENTION_DAYS: "0",
      MAX_OBJECTS: "100",
      ALLOW_RETENTION_ZERO: "1",
    });
    expect(result.status).toBe(0);
    // headers.get() returns "" for empty metadata — falsy, so treated as orphan.
    expect(await objectExists(malformed)).toBe(false);
    createdKeys.delete(malformed);
  });

  it("MAX_OBJECTS bounds a single run (truncated scan reported)", async () => {
    // Dedicated bucket: only the two objects seeded below exist, so the
    // candidate count is fully determined by this test.
    const keys = [`original/${randomUUID()}.webp`, `original/${randomUUID()}.webp`];
    for (const k of keys) await seedOriginal(k);
    const result = runCleanup({
      DRY_RUN: "0",
      RETENTION_DAYS: "0",
      MAX_OBJECTS: "1",
      ALLOW_RETENTION_ZERO: "1",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"truncated":true');
    // Exactly one candidate processed this run.
    expect(result.stdout).toContain('"orphanCandidates":1');
    // At least one of the two must remain (only one was processed).
    const survivors = [];
    for (const k of keys) if (await objectExists(k)) survivors.push(k);
    expect(survivors.length).toBe(1);
    for (const k of survivors) createdKeys.add(k);
    for (const k of keys) {
      if (!survivors.includes(k)) createdKeys.delete(k);
    }
  }, 20_000);

  it("MAX_OBJECTS still reports truncation when the budget lands on a young entry (BRAWUKA-592 re-review P2)", async () => {
    // Dedicated bucket: one young entry consumes the MAX_OBJECTS=1 scan
    // budget via a `continue` path, so the in-loop truncation check is
    // skipped. S3 still reports IsTruncated:true (a second page remains) —
    // the exit-path re-evaluation must set truncated:true.
    const young = `original/${randomUUID()}.webp`;
    const stale = `original/${randomUUID()}.webp`;
    await seedOriginal(young);
    await seedOriginal(stale);
    const result = runCleanup({
      DRY_RUN: "1",
      RETENTION_DAYS: "30",
      MAX_OBJECTS: "1",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"truncated":true');
    // The young entry consumed the only scan slot: nothing classified.
    expect(result.stdout).toContain('"orphanCandidates":0');
    expect(await objectExists(stale)).toBe(true);
  }, 20_000);

  it("rejects missing configuration with non-zero exit", async () => {
    try {
      execFileSync("node", ["scripts/clean-orphan-originals.mjs"], {
        cwd: IMAGE_SERVICE_ROOT,
        env: { ...process.env, R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "", R2_BUCKET_NAME: "" },
        stdio: "pipe",
        timeout: 30_000,
      });
      expect.unreachable("script should have exited non-zero");
    } catch (err) {
      const e = err as { status?: number };
      expect(e.status).not.toBe(0);
    }
  });
});
