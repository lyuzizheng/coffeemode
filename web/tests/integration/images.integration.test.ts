/**
 * @vitest-environment node
 *
 * Requires:
 *   docker compose up -d --wait postgres minio
 *   docker compose run --rm minio-init
 *   RUN_INTEGRATION=1 npm run test:integration:images
 *
 * Without RUN_INTEGRATION=1 the suite is skipped. With RUN_INTEGRATION=1 but
 * MinIO unreachable, tests are SKIPPED (not passed) so reports distinguish
 * "verified" from "vacuous". Once MinIO is reachable, storage failures throw —
 * a green run always exercised real storage.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AwsClient } from "aws4fetch";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  checkUploadIntent,
  consumeUploadIntent,
  recordUploadIntent,
} from "@/lib/db/image-uploads";
import { processImage } from "@/lib/images/processor";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import { TESTER_ID } from "../helpers/fixtures";
import {
  R2_ACCESS_KEY_ID,
  R2_ENDPOINT,
  deleteObject as r2DeleteObject,
  headObject,
  makePayload,
  minioReachable,
  presignedGetUrl,
  presignedPutUrl,
  r2Endpoint,
  tinyWebP,
} from "../helpers/r2";

// Storage suites never touch the rate limiter (in-memory only, BRAWUKA-378).
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeImages = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_test_img");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
let minioUp = false;
/** Object keys created by tests; afterAll deletes them and surfaces failures. */
const createdKeys = new Set<string>();
const cleanupErrors: string[] = [];
const previousDatabaseUrl = process.env.DATABASE_URL;

async function deleteObject(key: string): Promise<void> {
  try {
    await r2DeleteObject(key);
    createdKeys.delete(key);
  } catch (e) {
    cleanupErrors.push(`DELETE ${key} threw ${(e as Error).message}`);
    createdKeys.delete(key);
  }
}

describeImages("integration — real MinIO/R2 image round-trip (docker compose up -d --wait minio)", () => {
  beforeAll(async () => {
    minioUp = await minioReachable();
    if (!minioUp) {
      throw new Error(
        `MinIO is not reachable at ${R2_ENDPOINT}. The image integration suite requires a running MinIO instance (docker compose up -d --wait minio && docker compose run --rm minio-init).`,
      );
    }
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
    await dbClient.query(
      `insert into profiles (id, display_name) values ($1, 'img-tester') on conflict (id) do nothing`,
      [TESTER_ID],
    );
  }, 120_000);

  beforeEach(async () => {
    if (!dbClient) return;
    // No silent catch: truncate failure means polluted state → fail visibly.
    await dbClient.query("truncate table image_upload_intents restart identity cascade");
    await dbClient.query(
      `insert into profiles (id, display_name) values ($1, 'img-tester') on conflict (id) do nothing`,
      [TESTER_ID],
    );
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const key of [...createdKeys]) {
      await deleteObject(key);
    }
    for (const message of cleanupErrors) errors.push(new Error(message));
    try {
      await closePool();
    } catch (e) {
      errors.push(e);
    }
    try {
      await dbClient?.end();
    } catch (e) {
      errors.push(e);
    }
    if (RUN_INTEGRATION && testDbUrl) {
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (e) {
        errors.push(e);
      }
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (errors.length) throw new AggregateError(errors as Error[], "image integration cleanup failed");
  }, 60_000);

  it("presign → PUT → HEAD happy path stores the exact bytes", async () => {
    const key = `original/${randomUUID()}.webp`;
    createdKeys.add(key);
    const size = 1024;
    const { url, headers } = await presignedPutUrl(key, "image/webp", size);
    expect(url).toContain(key);
    // Content-Length stays signed into the URL but is never handed to fetch:
    // undici derives it from the body and rejects a manual value (BRAWUKA-338).
    expect(headers["Content-Length"]).toBeUndefined();
    expect(headers["content-length"]).toBeUndefined();
    const payload = makePayload(size);
    const putRes = await fetch(url, { method: "PUT", headers, body: payload as unknown as BodyInit });
    expect(putRes.ok).toBe(true);
    const head = await headObject(key);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(size);
  });

  it("missing object HEAD returns null (404, never another status)", async () => {
    const missing = await headObject(`original/${randomUUID()}.webp`);
    expect(missing).toBeNull();
  });

  it("tampered Content-Type breaks the signature → 403, object absent", async () => {
    const key = `original/${randomUUID()}.webp`;
    createdKeys.add(key);
    const size = 1024;
    const { url, headers } = await presignedPutUrl(key, "image/webp", size);
    // allHeaders signing covers Content-Type; swapping it must invalidate SigV4.
    const wrongHeaders = { ...headers, "Content-Type": "image/jpeg" };
    const putRes = await fetch(url, {
      method: "PUT",
      headers: wrongHeaders,
      body: makePayload(size) as unknown as BodyInit,
    });
    expect(putRes.ok).toBe(false);
    expect(putRes.status).toBe(403);
    expect(await headObject(key)).toBeNull();
  });

  it("reused intent is consumed once before remote work", async () => {
    await recordUploadIntent(TESTER_ID, randomUUID());
    const imageUuid = randomUUID();
    await recordUploadIntent(TESTER_ID, imageUuid);
    expect(await checkUploadIntent(TESTER_ID, imageUuid)).toBe(true);
    const first = await consumeUploadIntent(TESTER_ID, imageUuid);
    expect(first).toBe(true);
    const second = await consumeUploadIntent(TESTER_ID, imageUuid);
    expect(second).toBe(false);
    expect(await checkUploadIntent(TESTER_ID, imageUuid)).toBe(false);
  });

  it("processor downloads via presigned GET and re-uploads variants to MinIO", async () => {
    const imageUuid = randomUUID();
    const originalKey = `original/${imageUuid}.webp`;
    const cardKey = `card/${imageUuid}.webp`;
    const thumbKey = `thumbnail/${imageUuid}.webp`;
    for (const k of [originalKey, cardKey, thumbKey]) createdKeys.add(k);
    const payload = tinyWebP();
    const { url: putUrl, headers: putHeaders } = await presignedPutUrl(originalKey, "image/webp", payload.length);
    const putRes = await fetch(putUrl, { method: "PUT", headers: putHeaders, body: payload as unknown as BodyInit });
    expect(putRes.ok).toBe(true);

    const originalGet = await presignedGetUrl(originalKey);
    const originalPut = await presignedPutUrl(originalKey, "image/webp");
    const cardPut = await presignedPutUrl(cardKey, "image/webp");
    const thumbPut = await presignedPutUrl(thumbKey, "image/webp");

    const processed = await processImage(imageUuid, {
      imageUuid,
      original: originalGet,
      originalPut,
      card: cardPut,
      thumbnail: thumbPut,
      publicUrls: { original: "", card: "", thumbnail: "" },
      keys: { original: originalKey, card: cardKey, thumbnail: thumbKey },
    });
    expect(processed.width).toBeGreaterThan(0);
    expect(processed.height).toBeGreaterThan(0);
    const cardHead = await headObject(cardKey);
    const thumbHead = await headObject(thumbKey);
    expect(cardHead).not.toBeNull();
    expect(thumbHead).not.toBeNull();
    expect(cardHead!.size).toBeGreaterThan(0);
    expect(thumbHead!.size).toBeGreaterThan(0);
  });

  it("bad credentials surface as 403 (never silently 404/null)", async () => {
    const badClient = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: "wrong-secret",
      service: "s3",
      region: "auto",
    });
    const key = `original/${randomUUID()}.webp`;
    const res = await badClient.fetch(r2Endpoint(key), { method: "HEAD", redirect: "manual" });
    expect(res.status).toBe(403);
  });
});
