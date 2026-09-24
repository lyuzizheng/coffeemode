import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile as execFileAsyncCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
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

// BRAWUKA-699: the sweeper co-deletes `card/` + `thumbnail/` siblings when it
// removes an orphan original. The listing still scans `original/` only; the
// siblings are derived from the imageUuid, never listed.
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeVariants = RUN_INTEGRATION ? describe : describe.skip;

const IMAGE_SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../image-service",
);

let minioUp = false;
let currentBucket = "";
const createdKeys = new Set<string>();
const cleanupErrors: string[] = [];

async function createTestBucket(): Promise<string> {
  const bucket = `test-variant-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
    cleanupErrors.push(`DELETE bucket ${bucket} threw ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function seedObject(key: string, metadata?: Record<string, string>): Promise<void> {
  await r2PutObject(key, new Uint8Array(Buffer.alloc(64, 0x61)), metadata, currentBucket);
  createdKeys.add(key);
}

async function keyExists(key: string): Promise<boolean> {
  return r2ObjectExists(key, currentBucket);
}

function runCleanup(env: Record<string, string>): { status: number; stdout: string } {
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
    if (!err || typeof err !== "object") throw err;
    const status = "status" in err && typeof err.status === "number" ? err.status : 1;
    const stdout = "stdout" in err && typeof err.stdout === "string" ? err.stdout : "";
    return { status, stdout };
  }
}

describeVariants("integration — orphan variant co-delete (BRAWUKA-699)", () => {
  beforeAll(async () => {
    minioUp = await minioReachable();
    if (!minioUp) {
      throw new Error(
        `MinIO is not reachable at ${R2_ENDPOINT}. Variant co-delete tests require MinIO (docker compose up -d --wait minio && docker compose run --rm minio-init).`,
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
      try {
        await r2DeleteObject(key, currentBucket);
        createdKeys.delete(key);
      } catch (e) {
        cleanupErrors.push(`DELETE ${key} threw ${e instanceof Error ? e.message : String(e)}`);
        createdKeys.delete(key);
      }
    }
    await deleteTestBucket(currentBucket);
    currentBucket = "";
  });

  afterAll(async () => {
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors.map((m) => new Error(m)), "cleanup failures");
  });

  it("deletes card/thumbnail siblings with the orphan original", async () => {
    const uuid = randomUUID();
    const original = `original/${uuid}.webp`;
    const card = `card/${uuid}.webp`;
    const thumbnail = `thumbnail/${uuid}.webp`;
    await seedObject(original);
    await seedObject(card);
    await seedObject(thumbnail);

    const result = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1" });
    expect(result.status).toBe(0);
    expect(await keyExists(original)).toBe(false);
    expect(await keyExists(card)).toBe(false);
    expect(await keyExists(thumbnail)).toBe(false);
    createdKeys.delete(original);
    createdKeys.delete(card);
    createdKeys.delete(thumbnail);
  }, 20_000);

  it("dry-run reports the sibling variants without deleting them", async () => {
    const uuid = randomUUID();
    const original = `original/${uuid}.webp`;
    await seedObject(original);
    await seedObject(`card/${uuid}.webp`);
    await seedObject(`thumbnail/${uuid}.webp`);

    const result = runCleanup({ DRY_RUN: "1", RETENTION_DAYS: "0", MAX_OBJECTS: "100" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`"key":"${original}"`);
    expect(result.stdout).toContain(`card/${uuid}.webp`);
    expect(result.stdout).toContain(`thumbnail/${uuid}.webp`);
    expect(await keyExists(original)).toBe(true);
  });

  it("a missing sibling deletes as success (404-tolerant retry convergence)", async () => {
    // Only the original exists — no card/thumbnail were ever written (a
    // half-failed processImage). The run must still succeed and remove it.
    const uuid = randomUUID();
    const original = `original/${uuid}.webp`;
    await seedObject(original);

    const result = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1" });
    expect(result.status).toBe(0);
    expect(await keyExists(original)).toBe(false);
    createdKeys.delete(original);
  }, 20_000);

  it("a failing sibling is reported per key, never blocks the original", async () => {
    // Stub R2_ENDPOINT: LIST yields one stale markerless original; DELETE on
    // the `card/` sibling fails 403 while the rest succeed. 403 (like the
    // BRAWUKA-686 HEAD-failure stub) answers immediately — aws4fetch retries
    // only 5xx/429, so a 500 stub would burn ~28s in backoff. The run must
    // report the failed key and exit non-zero, while the original is gone.
    const uuid = randomUUID();
    const staleKey = `original/${uuid}.webp`;
    const cardKey = `card/${uuid}.webp`;
    const listXml =
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>` +
      `<Contents><Key>${staleKey}</Key><LastModified>2020-01-01T00:00:00.000Z</LastModified></Contents>` +
      `<IsTruncated>false</IsTruncated></ListBucketResult>`;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(listXml);
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "content-length": "64" });
        res.end();
        return;
      }
      if (req.method === "DELETE") {
        if ((url.pathname ?? "").endsWith(cardKey)) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        res.writeHead(200);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const execFileAsync = promisify(execFileAsyncCb);
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("stub R2 server has no TCP port");
      }
      const stubEndpoint = `http://127.0.0.1:${address.port}`;
      const { stdout }: { stdout: string } = await execFileAsync("node", ["scripts/clean-orphan-originals.mjs"], {
        cwd: IMAGE_SERVICE_ROOT,
        env: {
          ...process.env,
          R2_ACCESS_KEY_ID,
          R2_SECRET_ACCESS_KEY,
          R2_BUCKET_NAME: currentBucket || R2_BUCKET_NAME,
          R2_ENDPOINT: stubEndpoint,
          DRY_RUN: "0",
          RETENTION_DAYS: "0",
          MAX_OBJECTS: "100",
          ALLOW_RETENTION_ZERO: "1",
        } as NodeJS.ProcessEnv,
      });
      expect(stdout).toContain(cardKey);
      expect(stdout).toContain('"failed"');
    } catch (err) {
      // Exit code 1 is the expected outcome (a sibling failed); the failure
      // entry must name the card key either way. Promisified execFile
      // reports the exit as `code` (sync execFileSync uses `status`).
      if (!err || typeof err !== "object") throw err;
      const code = "code" in err && typeof err.code === "number" ? err.code : undefined;
      const stdout = "stdout" in err && typeof err.stdout === "string" ? err.stdout : "";
      expect(code).toBe(1);
      expect(stdout).toContain(cardKey);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }, 60_000);

  it("keeps siblings of a referenced original: reported, never deleted (BRAWUKA-400)", async () => {
    const uuid = randomUUID();
    const referenced = `original/${uuid}.webp`;
    const card = `card/${uuid}.webp`;
    const thumbnail = `thumbnail/${uuid}.webp`;
    await r2PutObject(referenced, new Uint8Array(Buffer.alloc(64, 0x61)), { targettype: "provision", targetid: uuid, userid: "u1" }, currentBucket);
    createdKeys.add(referenced);
    await seedObject(card);
    await seedObject(thumbnail);

    const dir = mkdtempSync(`${tmpdir()}/live-keys-`);
    const file = `${dir}/live-keys.txt`;
    try {
      writeFileSync(file, `${referenced}\n`);
      const result = runCleanup({ DRY_RUN: "0", RETENTION_DAYS: "0", MAX_OBJECTS: "100", ALLOW_RETENTION_ZERO: "1", LIVE_KEYS_FILE: file });
      expect(result.status).toBe(0);
      // The referenced original survives — and so do its variants, which the
      // sweeper never touches without their original.
      expect(await keyExists(referenced)).toBe(true);
      expect(await keyExists(card)).toBe(true);
      expect(await keyExists(thumbnail)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
