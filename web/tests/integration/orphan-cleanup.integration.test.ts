/**
 * @vitest-environment node
 * Real MinIO integration — orphan-original cleanup script (issue #158).
 *
 * Stacked on the #156 storage suite: same local MinIO stack and TEST_R2_* env
 * isolation. Runs image-service/scripts/clean-orphan-originals.mjs as a child
 * process against seeded objects:
 *
 *   - abandoned: original/ without completion metadata, older than retention → deleted
 *   - completed: original/ WITH x-amz-meta-targettype (live gallery original) → kept
 *   - young abandoned: no metadata but inside the retention window → kept
 *   - dry-run (default): reports would-delete without deleting
 *   - idempotent: second run deletes nothing
 *
 * Requires:
 *   docker compose up -d --wait postgres minio && docker compose run --rm minio-init
 *   RUN_INTEGRATION=1 npm run test:integration:images
 */

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// Storage suites never touch the rate limiter; pin the memory backend so
// tests/setup.ts's rateLimiter.reset() cannot hit Postgres after this file
// sets DATABASE_URL (sequential execution shares the process env).
process.env.RATE_LIMIT_BACKEND = "memory";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeCleanup = RUN_INTEGRATION ? describe : describe.skip;

const IMAGE_SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../image-service",
);

let minioUp = false;
const createdKeys = new Set<string>();
const cleanupErrors: string[] = [];

async function putObject(key: string, body: Uint8Array, metadata?: Record<string, string>): Promise<void> {
  await r2PutObject(key, body, metadata, R2_BUCKET_NAME);
  // r2PutObject throws on failure (unlike original expect); preserve createdKeys tracking.
  createdKeys.add(key);
}

async function objectExists(key: string): Promise<boolean> {
  return r2ObjectExists(key, R2_BUCKET_NAME);
}

async function deleteObject(key: string): Promise<void> {
  try {
    await r2DeleteObject(key, R2_BUCKET_NAME);
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
        R2_BUCKET_NAME,
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
      console.warn("MinIO not reachable — cleanup tests will SKIP");
      return;
    }
    // Create the dedicated test bucket (idempotent; BucketAlreadyOwnedByYou is fine).
    const url = `${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET_NAME}`;
    const res = await r2Client().fetch(url, { method: "PUT" }).catch((e) => e);
    const status = res instanceof Response ? res.status : 0;
    if (!(res instanceof Response)) throw res;
    if (![200, 409].includes(status)) {
      throw new Error(`bucket create failed with ${status}`);
    }
  });

  afterAll(async () => {
    for (const key of [...createdKeys]) await deleteObject(key);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors.map((m) => new Error(m)), "cleanup failures");
  });

  it("dry-run reports abandoned originals without deleting them", async (ctx) => {
    if (!minioUp) return ctx.skip();
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

  it("deletes only metadata-less originals; completed originals survive", async (ctx) => {
    if (!minioUp) return ctx.skip();
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


  it("is idempotent: a second run deletes nothing more", async (ctx) => {
    if (!minioUp) return ctx.skip();
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


  it("young metadata-less originals inside the retention window are kept", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const young = `original/${randomUUID()}.webp`;
    await seedOriginal(young);
    const result = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "30", MAX_OBJECTS: "100" });
    expect(result.status).toBe(0);
    expect(await objectExists(young)).toBe(true);
  });

  it("empty-string targetType metadata counts as abandoned (falsy marker)", async (ctx) => {
    if (!minioUp) return ctx.skip();
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

  it("MAX_OBJECTS bounds a single run (truncated scan reported)", async (ctx) => {
    if (!minioUp) return ctx.skip();
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


  it("rejects missing configuration with non-zero exit", async (ctx) => {
    if (!minioUp) return ctx.skip();
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
