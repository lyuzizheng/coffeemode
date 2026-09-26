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
 *   - final-marked reconciliation (BRAWUKA-725): a completed original whose
 *     DB row is tombstoned (post-commit delete leg failed during a storage
 *     outage) deletes against the live-keys export — original + card +
 *     thumbnail converge; a live-referenced final-marked original survives;
 *     a missing/empty export holds every final-marked original back
 *     (`finalHeld`, fail-closed), even with ALLOW_EMPTY_LIVE_KEYS=1
 *   - HEAD failure (BRAWUKA-400/BRAWUKA-686): stub R2_ENDPOINT answers 403
 *     on HEAD — the candidate is skipped, never deleted
 *   - idempotent: second run deletes nothing
 *
 * Requires:
 *   docker compose up -d --wait postgres minio && docker compose run --rm minio-init
 *   RUN_INTEGRATION=1 npm run test:integration:images
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile as execFileAsyncCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { softDeleteCheckIn } from "@/lib/db/checkins";
import { attachProvisionedPhotos } from "@/lib/images/photo-cleanup";
import {
  defaultProvisionPhotosDeps,
  type ProvisionPhotosDeps,
} from "@/lib/images/provision-photos";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import { CAFE_A, TESTER_ID, seedBaseData } from "../helpers/fixtures";
import {
  R2_ACCESS_KEY_ID,
  R2_CLEANUP_BUCKET_NAME as R2_BUCKET_NAME,
  R2_ENDPOINT,
  R2_SECRET_ACCESS_KEY,
  deleteObject as r2DeleteObject,
  minioReachable,
  objectExists as r2ObjectExists,
  presignedGetUrl,
  presignedPutUrl,
  putObject as r2PutObject,
  r2Client,
  r2Endpoint,
} from "../helpers/r2";

// Storage suites never touch the rate limiter (in-memory only, BRAWUKA-378).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeCleanup = RUN_INTEGRATION ? describe : describe.skip;

const IMAGE_SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../image-service",
);
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

/** Creation-flow key set for one image (original + both derived variants). */
function imageKeys(uuid: string): { original: string; card: string; thumbnail: string } {
  return {
    original: `original/${uuid}.webp`,
    card: `card/${uuid}.webp`,
    thumbnail: `thumbnail/${uuid}.webp`,
  };
}

/** `checkins.photos` element shaped like the real StoredImage rows. */
function photoJson(uuid: string): Record<string, unknown> {
  return { id: uuid, ...imageKeys(uuid), w: 1, h: 1, by: TESTER_ID, at: "2026-09-01T10:00:00.000Z" };
}

/** Custom metadata of an object (x-amz-meta-*; attach-state proof). */
async function headMetadata(key: string): Promise<Record<string, string>> {
  const res = await r2Client().fetch(r2Endpoint(key, currentBucket), {
    method: "HEAD",
    redirect: "manual",
  });
  if (res.status !== 200) throw new Error(`HEAD ${key} failed with ${res.status}`);
  const meta: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("x-amz-meta-")) meta[lower.slice("x-amz-meta-".length)] = value;
  });
  return meta;
}

/** Attach deps with the REAL `restampOriginal` (the post-attach re-stamp
 * under audit) but a local `getProcessUrls` that presigns against MinIO
 * instead of a live image-service — the re-stamp happens for real. */
function attachDeps(): ProvisionPhotosDeps {
  return {
    ...defaultProvisionPhotosDeps(),
    getProcessUrls: async ({ imageUuid, userId, targetType, targetId }) => {
      const keys = imageKeys(imageUuid);
      const metadata: Record<string, string> = { targettype: targetType, targetid: targetId };
      if (userId) metadata.userid = userId;
      return {
        imageUuid,
        original: await presignedGetUrl(keys.original, currentBucket),
        originalPut: await presignedPutUrl(
          keys.original,
          "image/webp",
          undefined,
          currentBucket,
          metadata,
        ),
        card: await presignedPutUrl(keys.card, "image/webp", undefined, currentBucket),
        thumbnail: await presignedPutUrl(keys.thumbnail, "image/webp", undefined, currentBucket),
        publicUrls: { original: "", card: "", thumbnail: "" },
        keys,
      };
    },
  };
}

/** Run the live-keys export (the scheduled cron job) against a database;
 * stdout is the file content the sweeper consumes. */
function runExport(databaseUrl: string): string {
  try {
    return execFileSync("node", ["scripts/export-live-image-keys.mjs"], {
      cwd: WEB_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
      timeout: 60_000,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    throw new Error(`live-keys export failed (status ${e.status ?? "?"}): ${e.message ?? ""}`);
  }
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

  it("skips candidates whose HEAD fails: never deletes on uncertain state (BRAWUKA-400/BRAWUKA-686)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // Stub R2_ENDPOINT: LIST yields one stale markerless candidate, every
    // HEAD fails 403 (aws4fetch retries only 5xx/429, so a 403 stub answers
    // immediately with no retry storm). The script must skip the candidate —
    // uncertain state is never deleted (BRAWUKA-400). DRY_RUN=0 so a
    // regression that classified the candidate as orphan would reach the
    // delete phase (deleteCalls > 0).
    const staleKey = `original/${randomUUID()}.webp`;
    const listXml =
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult>` +
      `<Contents><Key>${staleKey}</Key><LastModified>2020-01-01T00:00:00.000Z</LastModified></Contents>` +
      `<IsTruncated>false</IsTruncated></ListBucketResult>`;
    let headCalls = 0;
    let deleteCalls = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(listXml);
        return;
      }
      if (req.method === "HEAD") {
        headCalls += 1;
        res.writeHead(403);
        res.end();
        return;
      }
      if (req.method === "DELETE") {
        deleteCalls += 1;
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
      if (address === null || typeof address === "string") {
        throw new Error("stub R2 server has no TCP port");
      }
      // Async spawn: the stub must answer while the script runs. A sync
      // spawn blocks this event loop, starving the stub and forcing a
      // 60s timeout.
      const { stdout } = (await execFileAsync("node", ["scripts/clean-orphan-originals.mjs"], {
        cwd: IMAGE_SERVICE_ROOT,
        env: {
          ...process.env,
          TEST_R2_ACCESS_KEY_ID: undefined,
          R2_ACCESS_KEY_ID: "stub",
          R2_SECRET_ACCESS_KEY: "stub-secret",
          R2_BUCKET_NAME: "stub-bucket",
          R2_ENDPOINT: `http://127.0.0.1:${address.port}`,
          DRY_RUN: "0",
          RETENTION_DAYS: "0",
          MAX_OBJECTS: "100",
          ALLOW_RETENTION_ZERO: "1",
        } as NodeJS.ProcessEnv,
        timeout: 30_000,
      })) as { stdout: string };
      expect(headCalls).toBe(1);
      expect(stdout).toContain('"orphanCandidates":0');
      expect(stdout).not.toContain('"op":"would-delete"');
      expect(stdout).not.toContain(`"key":"${staleKey}"`);
      expect(deleteCalls).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }, 60_000);

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

  it("BRAWUKA-725 — attach → failed delete leg → tombstone → recovered cleanup converges all three keys", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // The full audited sequence: a real attach restamps the original to
    // targetType=checkin, the DB delete commits, the post-commit R2 leg
    // fails (image-service unreachable), and the later sweeper must
    // reconcile the final-marked original against the live-keys export
    // instead of skipping it. A live-referenced final-marked photo shares
    // the bucket and must survive every stage.
    const liveUuid = randomUUID();
    const deadUuid = randomUUID();
    const live = imageKeys(liveUuid);
    const dead = imageKeys(deadUuid);
    const checkinLive = randomUUID();
    const checkinDead = randomUUID();

    const adminUrl = integrationAdminUrl();
    const testDb = makeTestDbName("coffeemode_test_orphan_final");
    const dbUrl = testDatabaseUrl(adminUrl, testDb);
    const previousEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      IMAGE_SERVICE_URL: process.env.IMAGE_SERVICE_URL,
      IMAGE_SERVICE_TOKEN: process.env.IMAGE_SERVICE_TOKEN,
    };
    let dbClient: pg.Client | undefined;
    try {
      await provisionTestDatabase(adminUrl, testDb);
      process.env.DATABASE_URL = dbUrl;
      dbClient = new pg.Client(getPoolConfig(dbUrl));
      await dbClient.connect();
      // Baseline reset like db.integration: migration 0016 seeds the
      // service-account profile, so truncate before seeding or the plain
      // insert in seedBaseData hits profiles_pkey.
      await dbClient.query(
        "truncate table profiles, cafes, image_upload_intents, navigations restart identity cascade",
      );
      await seedBaseData(dbClient);
      await dbClient.query(
        `insert into checkins (id, cafe_id, user_id, scores, photos)
         values ($1, $2, $3, '{}'::jsonb, $4::jsonb), ($5, $2, $3, '{}'::jsonb, $6::jsonb)`,
        [
          checkinLive,
          CAFE_A,
          TESTER_ID,
          JSON.stringify([photoJson(liveUuid)]),
          checkinDead,
          JSON.stringify([photoJson(deadUuid)]),
        ],
      );

      // Creation flow left provision-stamped originals + variants behind.
      for (const uuid of [liveUuid, deadUuid]) {
        const provision = { targettype: "provision", targetid: uuid, userid: TESTER_ID };
        await seedOriginal(imageKeys(uuid).original, provision);
        await seedOriginal(imageKeys(uuid).card, provision);
        await seedOriginal(imageKeys(uuid).thumbnail, provision);
      }

      // Real attach: attachProvisionedPhotos + the real restampOriginal
      // re-stamp each original to targetType=checkin — the exact state the
      // sweeper used to skip forever.
      const deps = attachDeps();
      for (const [uuid, checkinId] of [
        [liveUuid, checkinLive],
        [deadUuid, checkinDead],
      ]) {
        const attached = await attachProvisionedPhotos(TESTER_ID, [uuid], checkinId, deps);
        expect(attached).toEqual([{ imageUuid: uuid, attached: true }]);
        expect((await headMetadata(imageKeys(uuid).original)).targettype).toBe("checkin");
      }

      // Storage outage: the image-service delete endpoint refuses
      // connections; the post-commit leg swallows the failure like the
      // production best-effort leg does.
      process.env.IMAGE_SERVICE_URL = "http://127.0.0.1:1";
      process.env.IMAGE_SERVICE_TOKEN = "brawuka-725-outage";
      await softDeleteCheckIn(TESTER_ID, checkinDead, defaultProvisionPhotosDeps());
      const tombstone = await dbClient.query("select deleted_at from checkins where id = $1", [
        checkinDead,
      ]);
      expect(tombstone.rows[0]?.deleted_at).not.toBeNull();
      // Leak reproduced: the tombstone committed, every object survived.
      for (const key of Object.values(dead)) {
        expect(await objectExists(key)).toBe(true);
      }

      // Authoritative export: the tombstoned photo dropped out, the live
      // one did not.
      const dir = mkdtempSync(`${tmpdir()}/live-keys-`);
      const keysFile = `${dir}/live-keys.txt`;
      try {
        const exported = runExport(dbUrl);
        writeFileSync(keysFile, exported);
        expect(exported).toContain(live.original);
        expect(exported).not.toContain(dead.original);

        // Dry-run: the final-marked orphan is a deletion candidate now,
        // with both derived variants listed for co-delete.
        const dry = runCleanup({
          DRY_RUN: "1",
          RETENTION_DAYS: "0",
          MAX_OBJECTS: "100",
          LIVE_KEYS_FILE: keysFile,
        });
        expect(dry.status).toBe(0);
        expect(dry.stdout).toContain(`"op":"would-delete","key":"${dead.original}"`);
        expect(dry.stdout).toContain('"stage":"final"');
        expect(dry.stdout).toContain('"verification":"not-referenced"');
        expect(dry.stdout).toContain(`"card/${deadUuid}.webp`);
        expect(dry.stdout).toContain(`"thumbnail/${deadUuid}.webp`);
        expect(dry.stdout).toContain('"finalHeld":0');
        // The live final-marked original is kept silently — no line at all.
        expect(dry.stdout).not.toContain(`"key":"${live.original}"`);

        // Recovery: DRY_RUN=0 converges the tombstoned photo's three keys
        // and leaves the live photo's three keys untouched.
        const converged = runCleanup({
          DRY_RUN: "0",
          RETENTION_DAYS: "0",
          MAX_OBJECTS: "100",
          ALLOW_RETENTION_ZERO: "1",
          LIVE_KEYS_FILE: keysFile,
        });
        expect(converged.status).toBe(0);
        expect(converged.stdout).toContain('"op":"done"');
        for (const key of Object.values(dead)) {
          expect(await objectExists(key)).toBe(false);
        }
        for (const key of Object.values(live)) {
          expect(await objectExists(key)).toBe(true);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await closePool().catch((e) => console.warn("closePool:", e));
      await dbClient?.end().catch((e) => console.warn("test db client:", e));
      await cleanupIntegrationDatabase(adminUrl, testDb).catch((e) =>
        console.warn("drop test db:", e),
      );
    }
  }, 240_000);

  it("BRAWUKA-725 — reconciles a partially deleted final-marked photo, keeps a live-referenced one", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // Storage-only: the originals already carry the final checkin marker
    // (the post-attach state). The dead photo's card is already gone — the
    // failed delete leg got that far — so only the original + thumbnail
    // remain to converge, while a live-referenced final-marked original
    // shares the run and must survive it.
    const deadUuid = randomUUID();
    const liveUuid = randomUUID();
    const dead = imageKeys(deadUuid);
    const live = imageKeys(liveUuid);
    const finalMarker = (uuid: string) => ({
      targettype: "checkin",
      targetid: uuid,
      userid: TESTER_ID,
    });
    await seedOriginal(dead.original, finalMarker(deadUuid));
    await seedOriginal(dead.thumbnail, finalMarker(deadUuid));
    await seedOriginal(live.original, finalMarker(liveUuid));

    const dir = mkdtempSync(`${tmpdir()}/live-keys-`);
    const keysFile = `${dir}/live-keys.txt`;
    try {
      writeFileSync(keysFile, `${live.original}\n`);

      const dry = runCleanup({
        DRY_RUN: "1",
        RETENTION_DAYS: "0",
        MAX_OBJECTS: "100",
        LIVE_KEYS_FILE: keysFile,
      });
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain('"orphanCandidates":1');
      expect(dry.stdout).toContain('"finalHeld":0');
      expect(dry.stdout).toContain(`"op":"would-delete","key":"${dead.original}"`);
      expect(dry.stdout).toContain(`"thumbnail/${deadUuid}.webp`);
      expect(dry.stdout).not.toContain(`"key":"${live.original}"`);

      const converged = runCleanup({
        DRY_RUN: "0",
        RETENTION_DAYS: "0",
        MAX_OBJECTS: "100",
        ALLOW_RETENTION_ZERO: "1",
        LIVE_KEYS_FILE: keysFile,
      });
      expect(converged.status).toBe(0);
      expect(await objectExists(dead.original)).toBe(false);
      expect(await objectExists(dead.thumbnail)).toBe(false);
      expect(await objectExists(dead.card)).toBe(false);
      expect(await objectExists(live.original)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("BRAWUKA-725 — missing/empty export never authorizes final-marked deletion (fail-closed)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const uuid = randomUUID();
    const keys = imageKeys(uuid);
    const marker = { targettype: "checkin", targetid: uuid, userid: TESTER_ID };
    await seedOriginal(keys.original, marker);
    await seedOriginal(keys.card, marker);
    await seedOriginal(keys.thumbnail, marker);

    // No export at all: the final-marked original is HELD, never a
    // would-delete candidate — not even in a dry-run report.
    const dry = runCleanup({ DRY_RUN: "1", RETENTION_DAYS: "0", MAX_OBJECTS: "100" });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('"finalHeld":1');
    expect(dry.stdout).not.toContain(keys.original);

    // DRY_RUN=0 with no export: still held, nothing touched.
    const held = runCleanup({
      DRY_RUN: "0",
      RETENTION_DAYS: "0",
      MAX_OBJECTS: "100",
      ALLOW_RETENTION_ZERO: "1",
    });
    expect(held.status).toBe(0);
    expect(held.stdout).toContain('"finalHeld":1');
    for (const key of Object.values(keys)) {
      expect(await objectExists(key)).toBe(true);
    }

    // A set-but-empty export (failed/truncated run) refuses production
    // deletes outright (BRAWUKA-632), and its explicit opt-in does NOT
    // extend to final-marked originals (BRAWUKA-725): they stay held.
    const dir = mkdtempSync(`${tmpdir()}/live-keys-empty-`);
    const file = `${dir}/live-keys.txt`;
    try {
      writeFileSync(file, "");
      const refused = runCleanup({
        DRY_RUN: "0",
        RETENTION_DAYS: "0",
        MAX_OBJECTS: "100",
        ALLOW_RETENTION_ZERO: "1",
        LIVE_KEYS_FILE: file,
      });
      expect(refused.status).not.toBe(0);
      const optedIn = runCleanup({
        DRY_RUN: "0",
        RETENTION_DAYS: "0",
        MAX_OBJECTS: "100",
        ALLOW_RETENTION_ZERO: "1",
        LIVE_KEYS_FILE: file,
        ALLOW_EMPTY_LIVE_KEYS: "1",
      });
      expect(optedIn.status).toBe(0);
      expect(optedIn.stdout).toContain('"finalHeld":1');
      for (const key of Object.values(keys)) {
        expect(await objectExists(key)).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
