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
import { AwsClient } from "aws4fetch";

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

// Same isolation as images.integration.test.ts — never inherit ambient R2 creds.
const R2_ACCESS_KEY_ID = process.env.TEST_R2_ACCESS_KEY_ID ?? "imgtest";
const R2_SECRET_ACCESS_KEY = process.env.TEST_R2_SECRET_ACCESS_KEY ?? "imgtest-secret";
const R2_BUCKET_NAME = process.env.TEST_R2_BUCKET_NAME ?? "coffeemode";
const R2_ENDPOINT = process.env.TEST_R2_ENDPOINT ?? "http://localhost:9000";

let minioUp = false;
const createdKeys = new Set<string>();
const cleanupErrors: string[] = [];

function r2Endpoint(key: string): string {
  return `${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET_NAME}/${key}`;
}

function r2Client(): AwsClient {
  return new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

async function putObject(key: string, body: Uint8Array, metadata?: Record<string, string>): Promise<void> {
  const url = `${r2Endpoint(key)}?X-Amz-Expires=600`;
  const headers: Record<string, string> = { "Content-Type": "image/webp" };
  for (const [k, v] of Object.entries(metadata ?? {})) headers[`x-amz-meta-${k}`] = v;
  const request = new Request(url, { method: "PUT", headers });
  const signed = await r2Client().sign(request, { aws: { signQuery: true, allHeaders: true } });
  const outHeaders: Record<string, string> = {};
  signed.headers.forEach((v, k) => {
    if (k.toLowerCase() !== "host") outHeaders[k] = v;
  });
  delete outHeaders["content-type"];
  outHeaders["Content-Type"] = "image/webp";
  for (const [k, v] of Object.entries(metadata ?? {})) outHeaders[`x-amz-meta-${k}`] = v;
  const res = await fetch(signed.url.toString(), {
    method: "PUT",
    headers: outHeaders,
    body: body as unknown as BodyInit,
  });
  expect(res.ok).toBe(true);
  createdKeys.add(key);
}

async function objectExists(key: string): Promise<boolean> {
  const res = await r2Client().fetch(r2Endpoint(key), { method: "HEAD", redirect: "manual" });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HEAD ${key} failed ${res.status}`);
  return true;
}

async function deleteObject(key: string): Promise<void> {
  try {
    const res = await r2Client().fetch(r2Endpoint(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) cleanupErrors.push(`DELETE ${key} -> ${res.status}`);
    createdKeys.delete(key);
  } catch (e) {
    cleanupErrors.push(`DELETE ${key} threw ${(e as Error).message}`);
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
    try {
      const res = await fetch(`${R2_ENDPOINT}/minio/health/live`, { signal: AbortSignal.timeout(2000) });
      minioUp = res.ok || res.status === 404;
    } catch {
      minioUp = false;
    }
    if (!minioUp) console.warn("MinIO not reachable — cleanup tests will SKIP");
  });

  afterAll(async () => {
    for (const key of [...createdKeys]) await deleteObject(key);
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors.map((m) => new Error(m)), "cleanup failures");
  });

  it("dry-run reports abandoned originals without deleting them", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const abandoned = `original/${randomUUID()}.webp`;
    const completed = `original/${randomUUID()}.webp`;
    await seedOriginal(abandoned);
    await seedOriginal(completed, { targettype: "cafe", targetid: randomUUID(), userid: "u1" });

    const result = runCleanup({ DRY_RUN: "1", RETENTION_DAYS: "0", MAX_OBJECTS: "100" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"op":"would-delete"');
    expect(result.stdout).toContain(abandoned);
    expect(result.stdout).not.toContain(`"key":"${completed}"`);
    // Dry-run must not delete.
    expect(await objectExists(abandoned)).toBe(true);
    expect(await objectExists(completed)).toBe(true);
  });

  it("deletes only metadata-less originals; completed originals survive", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const abandoned = `original/${randomUUID()}.webp`;
    const completed = `original/${randomUUID()}.webp`;
    await seedOriginal(abandoned);
    await seedOriginal(completed, { targettype: "checkin", targetid: randomUUID(), userid: "u1" });

    const result = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"op":"done"');

    expect(await objectExists(abandoned)).toBe(false);
    expect(await objectExists(completed)).toBe(true);
    createdKeys.delete(abandoned); // already gone; skip afterAll re-delete
  });

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
  });

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
    const remaining = keys.filter((k) => createdKeys.has(k) && k !== keys[0]);
    // At least one of the two must remain (only one was processed).
    const survivors = [];
    for (const k of keys) if (await objectExists(k)) survivors.push(k);
    expect(survivors.length).toBe(1);
    for (const k of survivors) createdKeys.add(k);
    for (const k of keys) {
      if (!survivors.includes(k)) createdKeys.delete(k);
    }
  });

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
