/**
 * @vitest-environment node
 *
 * HTTP write-budget + concurrent-delete race suite (BRAWUKA-165 follow-up to
 * the BRAWUKA-150 review of PR #340).
 *
 * 1. Per-user `cafes-write` budget at HTTP level: the mocked unit test in
 *    `web/tests/cafes.test.ts` proves the limiter trips, but only this suite
 *    proves it trips through the real route + Postgres-backed limiter stack
 *    with real HTTP statuses (404s consume the write token because the rate
 *    check in `DELETE /api/cafes/[id]` runs before the existence probe).
 * 2. Concurrent double-delete race: two simultaneous owner DELETEs against a
 *    sole-owner cafe must serialize on the `FOR UPDATE` row lock — exactly
 *    one 200 shell, one 404, no duplicate removal.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cafeDetailGET, DELETE as cafeDELETE } from "@/app/api/cafes/[id]/route";
import { GET as cafesGET, POST as cafesPOST } from "@/app/api/cafes/route";
import { POST as uploadPOST } from "@/app/api/images/upload/route";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import type * as ImageServiceClient from "@/lib/images/image-service-client";
import {
  apiClient,
  createHttpTestUsers,
  resetRateLimits,
  routeParams,
  seedHttpTestUsers,
  type ApiClient,
  type RouteContext,
} from "../helpers/http-client";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import {
  deleteObject as r2DeleteObject,
  minioReachable,
  presignedGetUrl,
  presignedPutUrl,
  r2Endpoint,
  tinyWebP,
} from "../helpers/r2";

// Hoist set for tracking created MinIO object keys for clean afterAll teardown
const { createdKeys } = vi.hoisted(() => ({
  createdKeys: new Set<string>(),
}));

// Mock authentication seam: getCurrentUser programmed via setCurrentTestUser in http-client
vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

// Mock Image Service Client seam: generate real MinIO presigned URLs so cafe
// creation (which requires 1–6 provisioned photos) runs without the worker.
vi.mock("@/lib/images/image-service-client", async (importOriginal) => {
  const actual = await importOriginal<typeof ImageServiceClient>();
  return {
    ...actual,
    requestUploadUrl: vi.fn(async (size: number) => {
      const imageUuid = randomUUID();
      const originalKey = `original/${imageUuid}.webp`;
      createdKeys.add(originalKey);
      const { url, headers } = await presignedPutUrl(originalKey, "image/webp", size);
      return {
        imageUuid,
        uploadUrl: url,
        uploadHeaders: headers,
        publicUrl: r2Endpoint(originalKey),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        maxUploadBytes: 10 * 1024 * 1024,
        size,
      };
    }),
    getProcessUrls: vi.fn(async ({ imageUuid }: { imageUuid: string }) => {
      const originalKey = `original/${imageUuid}.webp`;
      const cardKey = `card/${imageUuid}.webp`;
      const thumbKey = `thumbnail/${imageUuid}.webp`;
      createdKeys.add(originalKey);
      createdKeys.add(cardKey);
      createdKeys.add(thumbKey);
      const originalGet = await presignedGetUrl(originalKey);
      const originalPut = await presignedPutUrl(originalKey, "image/webp");
      const cardPut = await presignedPutUrl(cardKey, "image/webp");
      const thumbPut = await presignedPutUrl(thumbKey, "image/webp");
      return {
        imageUuid,
        original: originalGet,
        originalPut,
        card: cardPut,
        thumbnail: thumbPut,
        publicUrls: {
          original: r2Endpoint(originalKey),
          card: r2Endpoint(cardKey),
          thumbnail: r2Endpoint(thumbKey),
        },
        keys: { original: originalKey, card: cardKey, thumbnail: thumbKey },
      };
    }),
  };
});

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeBudget = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_http_write_budget");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const cleanupErrors: string[] = [];
const previousDatabaseUrl = process.env.DATABASE_URL;

const users = createHttpTestUsers();
const clientA = apiClient(users.userA);

/** `{ params: Promise<{ id }> }` ctx for detail/delete handlers. */
type IdCtx = RouteContext<{ id: string }>;

interface CafeDetailDTO {
  work_stats: { n_checkins: number; n_users: number };
  gallery: unknown[];
  maintained_by_service: boolean;
}

/**
 * Upload a valid fake WebP image through the real HTTP API and MinIO storage.
 * Returns the provisioned imageUuid for use as a creation photo.
 */
async function uploadTestWebP(client: ApiClient): Promise<string> {
  const payload = tinyWebP();
  const res = await client.post<{
    imageUuid: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  }>(uploadPOST, "/api/images/upload", { size: payload.byteLength });

  expect(res.status).toBe(200);
  expect(res.data.imageUuid).toBeDefined();

  const putRes = await fetch(res.data.uploadUrl, {
    method: "PUT",
    headers: res.data.uploadHeaders,
    body: payload as unknown as BodyInit,
  });
  expect(putRes.ok).toBe(true);
  return res.data.imageUuid;
}

/**
 * Bootstrap one sole-owner cafe through HTTP only: photo upload + fused
 * POST /api/cafes. Returns the cafe id.
 */
async function createSoleOwnerCafe(client: ApiClient, nonce: string): Promise<string> {
  const photoId = await uploadTestWebP(client);
  const res = await client.post<{ cafeId: string; checkinId: string }>(cafesPOST, "/api/cafes", {
    name: `Race Shell ${nonce}`,
    lat: 1.3048,
    lng: 103.8318,
    address: "1 Orchard Rd, Singapore",
    city: "singapore",
    google_place_id: `ChIJWRITEBUDGET${nonce}`,
    price_range: 2,
    checkin: {
      scores: { overall: 80 },
      max_stay: "unlimited",
      note: "race fixture",
      photo_ids: [photoId],
    },
  });
  expect(res.status).toBe(201);
  return res.data.cafeId;
}

describeBudget("http write budget + delete race (BRAWUKA-165)", () => {
  beforeAll(async () => {
    const minioUp = await minioReachable();
    if (!minioUp) {
      throw new Error("MinIO not reachable — RUN_INTEGRATION=1 requires MinIO for cafe photo bootstrap");
    }

    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;

    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();

    // Harness provisioning: deterministic profile rows (no product SQL).
    await seedHttpTestUsers(dbClient, users);
  }, 120_000);

  beforeEach(async () => {
    await resetRateLimits(dbClient);
  });

  afterAll(async () => {
    const errors: unknown[] = [];
    for (const key of [...createdKeys]) {
      try {
        await r2DeleteObject(key);
        createdKeys.delete(key);
      } catch (err) {
        cleanupErrors.push(`DELETE ${key} threw ${(err as Error).message}`);
        createdKeys.delete(key);
      }
    }
    for (const msg of cleanupErrors) errors.push(new Error(msg));

    try {
      await closePool();
    } catch (err) {
      errors.push(err);
    }

    try {
      await dbClient?.end();
    } catch (err) {
      errors.push(err);
    }

    if (RUN_INTEGRATION && testDbUrl) {
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (err) {
        errors.push(err);
      }
    }

    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (errors.length > 0) {
      throw new AggregateError(errors, "http-write-budget integration cleanup failed");
    }
  }, 60_000);

  it("trips the per-user cafes-write budget at HTTP level: 10 pass, 11th is 429", async () => {
    // Each DELETE runs the real rate check before the existence probe, so a
    // 404 on a fresh id still consumes one write token for this user.
    for (let i = 0; i < 10; i += 1) {
      const ghost = randomUUID();
      const res = await clientA.delete(
        cafeDELETE,
        `/api/cafes/${ghost}`,
        undefined,
        {},
        routeParams({ id: ghost }),
      );
      expect(res.status).toBe(404);
    }

    const ghost = randomUUID();
    const limited = await clientA.delete(
      cafeDELETE,
      `/api/cafes/${ghost}`,
      undefined,
      {},
      routeParams({ id: ghost }),
    );
    expect(limited.status).toBe(429);
    expect(limited.data).toMatchObject({ error: "rate_limited" });
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  it("serializes concurrent owner deletes: one shell, one 404, no double removal", async () => {
    const cafeId = await createSoleOwnerCafe(clientA, randomUUID().replaceAll("-", "").slice(0, 12));
    // Isolate the race from the bootstrap's own write token.
    await resetRateLimits(dbClient);

    const [first, second] = await Promise.all([
      clientA.delete(cafeDELETE, `/api/cafes/${cafeId}`, undefined, {}, routeParams({ id: cafeId })),
      clientA.delete(cafeDELETE, `/api/cafes/${cafeId}`, undefined, {}, routeParams({ id: cafeId })),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 404]);

    const winner = first.status === 200 ? first : second;
    expect(winner.data).toEqual({
      ok: true,
      id: cafeId,
      removed_checkins: 1,
      owner_transferred: false,
      shell: true,
    });

    // The shell survives exactly once: no check-ins, empty gallery.
    const detail = await clientA.get<CafeDetailDTO, IdCtx, Request>(
      cafeDetailGET,
      `/api/cafes/${cafeId}`,
      {},
      routeParams({ id: cafeId }),
    );
    expect(detail.status).toBe(200);
    expect(detail.data.work_stats.n_checkins).toBe(0);
    expect(detail.data.gallery).toEqual([]);
    expect(detail.data.maintained_by_service).toBe(false);

    // Sanity: the cafe row is untouched by the limiter-adjacent surface.
    const nearby = await clientA.get<{ cafes: Array<{ id: string }> }>(cafesGET, "/api/cafes", {
      query: { lat: "1.3048", lng: "103.8318", radius_km: "10" },
    });
    expect(nearby.status).toBe(200);
    expect(nearby.data.cafes.map((c) => c.id)).toContain(cafeId);
  });
});
