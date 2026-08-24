/**
 * @vitest-environment node
 * Real MinIO/R2 integration — presign → PUT → HEAD → complete round-trip.
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
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
  runMigrations,
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

// Storage suites never touch the rate limiter; pin the memory backend so
// tests/setup.ts's rateLimiter.reset() cannot hit Postgres after this file
// sets DATABASE_URL (sequential execution shares the process env).
process.env.RATE_LIMIT_BACKEND = "memory";

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
      console.warn("MinIO not reachable at", R2_ENDPOINT, "— tests will SKIP");
      return;
    }
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    runMigrations(testDbUrl);
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
    await dbClient.query(
      `insert into profiles (id, display_name) values ($1, 'img-tester') on conflict (id) do nothing`,
      [TESTER_ID],
    );
  }, 120_000);

  beforeEach(async () => {
    if (!minioUp || !dbClient) return; // beforeAll skipped provisioning
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
      const admin = new pg.Client(getPoolConfig(adminDbUrl));
      try {
        await admin.connect();
        await admin.query(`drop database if exists ${quotedIdentifier(TEST_DB)} with (force)`);
      } catch (e) {
        errors.push(e);
      } finally {
        try {
          await admin.end();
        } catch (e) {
          errors.push(e);
        }
      }
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (errors.length) throw new AggregateError(errors as Error[], "image integration cleanup failed");
  });

  it("presign → PUT → HEAD happy path stores the exact bytes", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const key = `original/${randomUUID()}.webp`;
    createdKeys.add(key);
    const size = 1024;
    const { url, headers } = await presignedPutUrl(key, "image/webp", size);
    expect(url).toContain(key);
    expect(headers["Content-Length"]).toBe(String(size));
    const payload = makePayload(size);
    const putRes = await fetch(url, { method: "PUT", headers, body: payload as unknown as BodyInit });
    expect(putRes.ok).toBe(true);
    const head = await headObject(key);
    expect(head).not.toBeNull();
    expect(head!.size).toBe(size);
  });

  it("missing object HEAD returns null (404, never another status)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const missing = await headObject(`original/${randomUUID()}.webp`);
    expect(missing).toBeNull();
  });

  it("tampered Content-Type breaks the signature → 403, object absent", async (ctx) => {
    if (!minioUp) return ctx.skip();
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

  it("reused intent is consumed once before remote work", async (ctx) => {
    if (!minioUp) return ctx.skip();
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

  it("processor downloads via presigned GET and re-uploads variants to MinIO", async (ctx) => {
    if (!minioUp) return ctx.skip();
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

  it("completeImageUpload end-to-end: real storage + DB gallery/intent metadata", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // Seed an owned cafe so the ownership pre-check passes.
    const cafeId = randomUUID();
    await dbClient.query(
      `insert into cafes (id, name, location, city, created_by, tz)
       values ($1, 'Roundtrip Cafe', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography,
               'singapore', $2, 'Asia/Singapore')`,
      [cafeId, TESTER_ID],
    );

    const imageUuid = randomUUID();
    const originalKey = `original/${imageUuid}.webp`;
    const cardKey = `card/${imageUuid}.webp`;
    const thumbKey = `thumbnail/${imageUuid}.webp`;
    for (const k of [originalKey, cardKey, thumbKey]) createdKeys.add(k);

    // Upload the original through a real presigned PUT.
    const payload = tinyWebP();
    const { url: putUrl, headers: putHeaders } = await presignedPutUrl(originalKey, "image/webp", payload.length);
    const putRes = await fetch(putUrl, { method: "PUT", headers: putHeaders, body: payload as unknown as BodyInit });
    expect(putRes.ok).toBe(true);

    // Bind the intent to the tester (as /api/images/upload would).
    await recordUploadIntent(TESTER_ID, imageUuid);

    // Drive the REAL completion service with its default deps: they resolve to
    // the real getProcessUrls (needs IMAGE_SERVICE_* env? no — default deps use
    // the injected client; here we pass explicit deps wired to local MinIO).
    const { completeImageUpload } = await import("@/lib/images/complete");
    const result = await completeImageUpload(
      { id: TESTER_ID },
      { imageUuid, targetType: "cafe" as const, targetId: cafeId },
      {
        query: async (text: string, params?: unknown[]) =>
          (await import("@/lib/db/postgres")).query(text as string, params),
        runInTransaction: async (fn) =>
          (
            await import("@/lib/db/postgres")
          ).withTransaction(async (client) => fn(client.query.bind(client) as never)),
        checkUploadIntent,
        consumeUploadIntent,
        getProcessUrls: async (req) => ({
          imageUuid: req.imageUuid,
          original: await presignedGetUrl(originalKey),
          originalPut: await presignedPutUrl(originalKey, "image/webp"),
          card: await presignedPutUrl(cardKey, "image/webp"),
          thumbnail: await presignedPutUrl(thumbKey, "image/webp"),
          publicUrls: {
            original: `http://images.test/${originalKey}`,
            card: `http://images.test/${cardKey}`,
            thumbnail: `http://images.test/${thumbKey}`,
          },
          keys: { original: originalKey, card: cardKey, thumbnail: thumbKey },
        }),
        processImage,
      },
    );
    expect(result.attached).toBe(true);
    expect(result.storedImage).toMatchObject({
      id: imageUuid,
      w: expect.any(Number),
      h: expect.any(Number),
      by: TESTER_ID,
      source: { type: "cafe", id: cafeId },
    });

    // DB metadata: gallery contains the StoredImage; intent consumed.
    const { rows } = await dbClient.query("select gallery from cafes where id = $1", [cafeId]);
    const gallery = rows[0].gallery as Array<Record<string, unknown>>;
    expect(gallery).toHaveLength(1);
    expect(gallery[0]).toMatchObject({ id: imageUuid, by: TESTER_ID });
    const intent = await dbClient.query(
      "select image_uuid from image_upload_intents where image_uuid = $1",
      [imageUuid],
    );
    expect(intent.rows).toHaveLength(0);

    // Storage: all three variants exist.
    for (const k of [originalKey, cardKey, thumbKey]) {
      const head = await headObject(k);
      expect(head).not.toBeNull();
    }

    // Replay: second complete for the same intent must NOT attach again.
    const replay = await completeImageUpload(
      { id: TESTER_ID },
      { imageUuid, targetType: "cafe" as const, targetId: cafeId },
      {
        query: async (text: string, params?: unknown[]) =>
          (await import("@/lib/db/postgres")).query(text as string, params),
        runInTransaction: async (fn) =>
          (
            await import("@/lib/db/postgres")
          ).withTransaction(async (client) => fn(client.query.bind(client) as never)),
        checkUploadIntent,
        consumeUploadIntent,
        getProcessUrls: async (req) => ({
          imageUuid: req.imageUuid,
          original: await presignedGetUrl(originalKey),
          originalPut: await presignedPutUrl(originalKey, "image/webp"),
          card: await presignedPutUrl(cardKey, "image/webp"),
          thumbnail: await presignedPutUrl(thumbKey, "image/webp"),
          publicUrls: { original: "", card: "", thumbnail: "" },
          keys: { original: originalKey, card: cardKey, thumbnail: thumbKey },
        }),
        processImage,
      },
    );
    expect(replay.attached).toBe(false);
    const after = await dbClient.query("select gallery from cafes where id = $1", [cafeId]);
    expect(after.rows[0].gallery).toHaveLength(1);
  });

  it("bad credentials surface as 403 (never silently 404/null)", async (ctx) => {
    if (!minioUp) return ctx.skip();
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
