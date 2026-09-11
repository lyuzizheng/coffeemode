/**
 * @vitest-environment node
 * Path 2: Cafe Creation & Image Pipeline HTTP Contract Suite (BRAWUKA-157 / Slice 2B)
 * Spec reference: docs/specs/0008-http-user-journey-matrix.md (§5 & §13 Slice 2B)
 *
 * Runs against real Postgres/PostGIS and real MinIO when RUN_INTEGRATION=1.
 * All operations drive external HTTP API Route Handlers exclusively through
 * web/tests/helpers/http-client.ts, with zero direct database mutation for product flows.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cafesPOST, GET as cafesGET } from "@/app/api/cafes/route";
import { GET as cafeDetailGET } from "@/app/api/cafes/[id]/route";
import { GET as checkinsGET } from "@/app/api/cafes/[id]/checkins/route";
import { POST as uploadPOST } from "@/app/api/images/upload/route";
import { GET as placesSearchGET } from "@/app/api/places/search/route";
import { POST as placesResolvePOST } from "@/app/api/places/resolve/route";
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
  R2_ENDPOINT,
  deleteObject as r2DeleteObject,
  minioReachable,
  presignedGetUrl,
  presignedPutUrl,
  r2Endpoint,
  tinyWebP,
} from "../helpers/r2";
import { createMockGooglePlacesResponse } from "../helpers/mocks";

// Hoist set for tracking created MinIO object keys for clean afterAll teardown
const { createdKeys } = vi.hoisted(() => ({
  createdKeys: new Set<string>(),
}));

// Mock authentication seam: getCurrentUser programmed via setCurrentTestUser in http-client
vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

// Mock POI client seam (mandatory): spec 0008 §5 — standard Google POI shape, zero external network requests
vi.mock("@/lib/places/poi-client", () => {
  return {
    searchExternalPOIs: vi.fn(async ({ q }: { q?: string }) => {
      return createMockGooglePlacesResponse({
        name: q ? `${q} Seed Roasters` : "Google POI Seed Roasters",
      });
    }),
    searchPOIs: vi.fn(async () => ({ results: [] })),
    resolveMapsUrl: vi.fn(async (mapsShareUrl: string) => {
      const match = mapsShareUrl.match(/place\/([^/?]+)/);
      const name = match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "Resolved Maps Cafe";
      return createMockGooglePlacesResponse({
        name,
        place_id: "ChIJRESOLVEDMAPSPOI01",
        address: "100 Orchard Blvd, Singapore",
        lat: 1.3042,
        lng: 103.8322,
      }).results[0]!;
    }),
    getPOI: vi.fn(async (placeId: string) => {
      return createMockGooglePlacesResponse({
        place_id: placeId,
      }).results[0]!;
    }),
    storeExternalPOIs: vi.fn(async (pois) => ({ stored: pois.length })),
  };
});

// Mock Image Service Client seam: when worker is unmounted, generate real MinIO presigned URLs
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
const describeHttp = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_http_cafe_media");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
let minioUp = false;
const cleanupErrors: string[] = [];
const previousDatabaseUrl = process.env.DATABASE_URL;

const users = createHttpTestUsers();
const clientA = apiClient(users.userA);
const clientB = apiClient(users.userB);
const clientC = apiClient(users.userC);
const clientD = apiClient(users.userD);
const guestClient = apiClient().asGuest();

/**
 * Upload a valid fake WebP image through the real HTTP API and MinIO storage.
 * Returns the provisioned imageUuid and upload details.
 */
async function uploadTestWebP(
  client: ApiClient,
  customPayload?: Uint8Array,
): Promise<{ imageUuid: string; uploadUrl: string; size: number }> {
  const payload = customPayload ?? tinyWebP();
  const res = await client.post<{
    imageUuid: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  }>(uploadPOST, "/api/images/upload", { size: payload.byteLength });

  expect(res.status).toBe(200);
  expect(res.data.imageUuid).toBeDefined();
  expect(res.data.uploadUrl).toBeDefined();

  const putRes = await fetch(res.data.uploadUrl, {
    method: "PUT",
    headers: res.data.uploadHeaders,
    body: payload as unknown as BodyInit,
  });
  expect(putRes.ok).toBe(true);

  return {
    imageUuid: res.data.imageUuid,
    uploadUrl: res.data.uploadUrl,
    size: payload.byteLength,
  };
}

describeHttp("Path 2: Cafe Creation & Image Pipeline HTTP Suite", () => {
  beforeAll(async () => {
    minioUp = await minioReachable();
    if (!minioUp) {
      console.warn("MinIO not reachable at", R2_ENDPOINT, "— tests will SKIP");
      return;
    }

    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;

    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();

    // Harness setup: provision deterministic profiles for users A, B, C, D
    await seedHttpTestUsers(dbClient, users);
  }, 120_000);

  beforeEach(async () => {
    if (!minioUp || !dbClient) return;
    await resetRateLimits(dbClient);
  });
  const createdCafeIds = new Set<string>();
  afterEach(async () => {
    if (!dbClient) return;
    for (const cafeId of createdCafeIds) {
      await dbClient.query("delete from checkin_likes where checkin_id in (select id from checkins where cafe_id = $1)", [cafeId]);
      await dbClient.query("delete from checkins where cafe_id = $1", [cafeId]);
      await dbClient.query("delete from cafes where id = $1", [cafeId]);
    }
    createdCafeIds.clear();
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
      throw new AggregateError(errors, "http-cafe-creation-media integration cleanup failed");
    }
  }, 60_000);

  // =========================================================================
  // 1. Mock POI & Media Pipeline Seam Verification
  // =========================================================================

  it("Path 2: mock POI client injects standard Google POI and verifies zero external network calls", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // 1. Authenticated Google Places search via POI proxy
    const searchRes = await clientA.get<{ results: Array<{ place_id: string; name: string; source: string; types: string[]; business_status: string }> }>(
      placesSearchGET,
      "/api/places/search",
      { query: { source: "google", q: "Orchard Nomad" } },
    );
    expect(searchRes.status).toBe(200);
    expect(searchRes.data.results).toBeInstanceOf(Array);
    expect(searchRes.data.results.length).toBeGreaterThan(0);

    const hit = searchRes.data.results[0]!;
    expect(hit.source).toBe("google");
    expect(hit.place_id).toMatch(/^ChIJ/);
    expect(hit.types).toContain("cafe");
    expect(hit.business_status).toBe("OPERATIONAL");

    // Anonymous Google POI search is rejected with 401 (cost protection)
    const anonSearch = await guestClient.get(
      placesSearchGET,
      "/api/places/search",
      { query: { source: "google", q: "Orchard Nomad" } },
    );
    expect(anonSearch.status).toBe(401);
    expect(anonSearch.data).toMatchObject({ error: "unauthorized" });

    // 2. Resolve Google Maps share URL via POI client
    const resolveRes = await clientA.post<{ place_id: string; name: string; lat: number; lng: number }>(
      placesResolvePOST,
      "/api/places/resolve",
      { maps_share_url: "https://maps.google.com/?cid=12345" },
    );
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.data.place_id).toBe("ChIJRESOLVEDMAPSPOI01");
    expect(resolveRes.data.lat).toBeCloseTo(1.3042, 4);
    expect(resolveRes.data.lng).toBeCloseTo(103.8322, 4);
  });

  it("Path 2: image upload pipeline acquires presigned MinIO URL, uploads WebP bytes, and records upload intent", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // 1. Anonymous upload is rejected with 401 unauthorized
    const anonUpload = await guestClient.post(uploadPOST, "/api/images/upload", { size: 1024 });
    expect(anonUpload.status).toBe(401);
    expect(anonUpload.data).toMatchObject({ error: "unauthorized" });

    // 2. Cross-origin upload is rejected with 403 forbidden_origin
    const evilOriginUpload = await clientA.post(
      uploadPOST,
      "/api/images/upload",
      { size: 1024 },
      { headers: { origin: "https://evil.example" } },
    );
    expect(evilOriginUpload.status).toBe(403);
    expect(evilOriginUpload.data).toMatchObject({ error: "forbidden_origin" });

    // 3. Validation negative matrix for upload
    const emptyUpload = await clientA.post(uploadPOST, "/api/images/upload", {});
    expect(emptyUpload.status).toBe(400);
    expect(emptyUpload.data).toMatchObject({ error: "invalid_request" });

    const negativeSizeUpload = await clientA.post(uploadPOST, "/api/images/upload", { size: -50 });
    expect(negativeSizeUpload.status).toBe(400);
    expect(negativeSizeUpload.data).toMatchObject({ error: "invalid_request" });

    const oversizedUpload = await clientA.post(uploadPOST, "/api/images/upload", { size: 15 * 1024 * 1024 });
    expect(oversizedUpload.status).toBe(400);
    expect(oversizedUpload.data).toMatchObject({ error: "size_exceeded" });

    // 4. Successful upload round-trip
    const uploaded = await uploadTestWebP(clientA);
    expect(uploaded.imageUuid).toBeDefined();
    expect(uploaded.size).toBeGreaterThan(0);

    // Verify upload intent recorded in DB for User A
    const intentRes = await dbClient.query(
      "select user_id from image_upload_intents where image_uuid = $1",
      [uploaded.imageUuid],
    );
    expect(intentRes.rows).toHaveLength(1);
    expect(intentRes.rows[0]?.user_id).toBe(users.userA.id);
  });

  // =========================================================================
  // 2. POST /api/cafes Authorization & Origin Checks
  // =========================================================================

  it("Path 2: POST /api/cafes rejects unauthenticated anonymous requests with 401 unauthorized", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const res = await guestClient.post(cafesPOST, "/api/cafes", {
      name: "Anonymous Nomad Cafe",
      lat: 1.3048,
      lng: 103.8318,
      checkin: {
        scores: { overall: 80 },
        max_stay: "unlimited",
        note: "Anonymous submission",
        photo_ids: [randomUUID()],
      },
    });
    expect(res.status).toBe(401);
    expect(res.data).toMatchObject({ error: "unauthorized" });
  });

  it("Path 2: POST /api/cafes rejects cross-origin requests with 403 forbidden_origin", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const res = await clientA.post(
      cafesPOST,
      "/api/cafes",
      {
        name: "Cross Origin Cafe",
        lat: 1.3048,
        lng: 103.8318,
        checkin: {
          scores: { overall: 80 },
          max_stay: "unlimited",
          note: "Cross origin test",
          photo_ids: [randomUUID()],
        },
      },
      { headers: { origin: "https://evil.example" } },
    );
    expect(res.status).toBe(403);
    expect(res.data).toMatchObject({ error: "forbidden_origin" });
  });

  // =========================================================================
  // 3. POST /api/cafes Parameter Validation Negative Matrix (400 invalid_request)
  // =========================================================================

  it("Path 2: POST /api/cafes rejects invalid bodies with 400 invalid_request (negative matrix)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const validPhoto = randomUUID();

    const cases: Array<{ name: string; body: unknown }> = [
      { name: "non-object body", body: "invalid string body" },
      { name: "empty object body", body: {} },
      {
        name: "missing name",
        body: { lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "empty name",
        body: { name: "   ", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "name exceeds 200 chars",
        body: { name: "a".repeat(201), lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "lat > 90",
        body: { name: "Bad Lat", lat: 90.1, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "lat < -90",
        body: { name: "Bad Lat", lat: -90.5, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "lng > 180",
        body: { name: "Bad Lng", lat: 1.3, lng: 180.5, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "lng < -180",
        body: { name: "Bad Lng", lat: 1.3, lng: -180.5, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "price_range < 1",
        body: { name: "Bad Price", lat: 1.3, lng: 103.8, price_range: 0, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "price_range > 4",
        body: { name: "Bad Price", lat: 1.3, lng: 103.8, price_range: 5, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "price_range non-integer",
        body: { name: "Bad Price", lat: 1.3, lng: 103.8, price_range: 2.5, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "missing checkin object",
        body: { name: "No Checkin", lat: 1.3, lng: 103.8 },
      },
      {
        name: "missing checkin.scores.overall",
        body: { name: "No Overall", lat: 1.3, lng: 103.8, checkin: { scores: { wifi: 80 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "checkin.scores.overall > 100",
        body: { name: "Score > 100", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 101 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "checkin.scores.wifi < 0",
        body: { name: "Score < 0", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80, wifi: -5 }, max_stay: "3h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "invalid checkin.max_stay value",
        body: { name: "Bad Stay", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "5h", note: "ok", photo_ids: [validPhoto] } },
      },
      {
        name: "missing checkin.note",
        body: { name: "No Note", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", photo_ids: [validPhoto] } },
      },
      {
        name: "empty checkin.note",
        body: { name: "Empty Note", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "   ", photo_ids: [validPhoto] } },
      },
      {
        name: "checkin.note exceeds 500 chars",
        body: { name: "Long Note", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "x".repeat(501), photo_ids: [validPhoto] } },
      },
      {
        name: "empty checkin.photo_ids array",
        body: { name: "Zero Photos", lat: 1.3, lng: 103.8, checkin: { scores: { overall: 80 }, max_stay: "3h", note: "ok", photo_ids: [] } },
      },
      {
        name: "checkin.photo_ids exceeds 6",
        body: {
          name: "Too Many Photos",
          lat: 1.3,
          lng: 103.8,
          checkin: {
            scores: { overall: 80 },
            max_stay: "3h",
            note: "ok",
            photo_ids: Array.from({ length: 7 }, () => randomUUID()),
          },
        },
      },
      {
        name: "checkin.photo_ids duplicate UUIDs",
        body: {
          name: "Duplicate Photos",
          lat: 1.3,
          lng: 103.8,
          checkin: {
            scores: { overall: 80 },
            max_stay: "3h",
            note: "ok",
            photo_ids: [validPhoto, validPhoto],
          },
        },
      },
      {
        name: "checkin.photo_ids non-UUID string",
        body: {
          name: "Non-UUID Photo",
          lat: 1.3,
          lng: 103.8,
          checkin: {
            scores: { overall: 80 },
            max_stay: "3h",
            note: "ok",
            photo_ids: ["not-a-valid-uuid"],
          },
        },
      },
      {
        name: "future visited_at timestamp",
        body: {
          name: "Future Visited",
          lat: 1.3,
          lng: 103.8,
          checkin: {
            scores: { overall: 80 },
            max_stay: "3h",
            note: "ok",
            photo_ids: [validPhoto],
            visited_at: new Date(Date.now() + 86_400_000 * 2).toISOString(),
          },
        },
      },
    ];

    for (const testCase of cases) {
      const res = await clientA.post(cafesPOST, "/api/cafes", testCase.body);
      expect(res.status, `Expected 400 for ${testCase.name}`).toBe(400);
      expect(res.data, `Expected invalid_request for ${testCase.name}`).toMatchObject({
        error: "invalid_request",
      });
    }
  });

  // =========================================================================
  // 4. Photo Intent Misuse & Abuse (400 invalid_photos)
  // =========================================================================

  it("Path 2: POST /api/cafes rejects unissued and foreign photo IDs with 400 invalid_photos", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // 1. Unissued photo UUID (never went through /api/images/upload)
    const unissuedUuid = randomUUID();
    const unissuedRes = await clientA.post(cafesPOST, "/api/cafes", {
      name: "Unissued Photo Cafe",
      lat: 1.3048,
      lng: 103.8318,
      checkin: {
        scores: { overall: 85 },
        max_stay: "unlimited",
        note: "Attempting unissued photo upload",
        photo_ids: [unissuedUuid],
      },
    });
    expect(unissuedRes.status).toBe(400);
    expect(unissuedRes.data).toMatchObject({ error: "invalid_photos" });

    // 2. Foreign photo UUID: User B uploads an image, User A attempts to consume it
    const uploadB = await uploadTestWebP(clientB);
    const foreignRes = await clientA.post(cafesPOST, "/api/cafes", {
      name: "Foreign Photo Cafe",
      lat: 1.3048,
      lng: 103.8318,
      checkin: {
        scores: { overall: 85 },
        max_stay: "unlimited",
        note: "Attempting to steal User B's photo",
        photo_ids: [uploadB.imageUuid],
      },
    });
    expect(foreignRes.status).toBe(400);
    expect(foreignRes.data).toMatchObject({ error: "invalid_photos" });
  });

  // =========================================================================
  // 5. Successful 201 Creation, Fused Checkin, TZ, Gallery & Initial Aggregate
  // =========================================================================

  it("Path 2: POST /api/cafes creates cafe with fused checkin, derives tz, binds gallery, and maps initial aggregate", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // User A uploads valid WebP
    const uploadA = await uploadTestWebP(clientA);
    const createdPhotoId = uploadA.imageUuid;
    const pioneerPlaceId = `ChIJORCHARDPIONEER_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

    // Spec 0008 §5 / §10: User A creates Cafe 1 in Singapore
    // Scores: wifi 90, outlets 80, seats 70, temp 60, coffee 95, overall 90, max_stay unlimited
    const createRes = await clientA.post<{ cafeId: string; checkinId: string; tz: string }>(
      cafesPOST,
      "/api/cafes",
      {
        name: "Orchard Pioneer Roasters",
        lat: 1.3048,
        lng: 103.8318,
        address: "1 Orchard Rd, Singapore",
        city: "singapore",
        google_place_id: pioneerPlaceId,
        price_range: 2,
        opening_hours: {
          mon: { open: "08:00", close: "22:00" },
          tue: { open: "08:00", close: "22:00" },
          wed: { open: "08:00", close: "22:00" },
          thu: { open: "08:00", close: "22:00" },
          fri: { open: "08:00", close: "22:00" },
          sat: { open: "08:00", close: "22:00" },
          sun: { open: "08:00", close: "22:00" },
        },
        checkin: {
          scores: {
            overall: 90,
            wifi: 90,
            outlets: 80,
            seats: 70,
            temp: 60,
            coffee: 95,
          },
          max_stay: "unlimited",
          note: "Flagship pioneering work cafe in Orchard",
          photo_ids: [createdPhotoId],
        },
      },
    );

    expect(createRes.status).toBe(201);
    expect(createRes.data.cafeId).toBeDefined();
    expect(createRes.data.checkinId).toBeDefined();
    expect(createRes.data.tz).toBe("Asia/Singapore");
    const createdCafeId = createRes.data.cafeId;
    const createdCheckinId = createRes.data.checkinId;
    createdCafeIds.add(createdCafeId);
    // Reconciliation via User D (external observer) GET /api/cafes/[id]
    const detailRes = await clientD.get<{
      id: string;
      name: string;
      tz: string;
      google_place_id: string;
      author: unknown;
      maintained_by_service: unknown;
      gallery: Array<{ id: string; source?: { type: string; id: string }; by?: unknown }>;
      work_stats: {
        experience_score: number | null;
        composite_score: number | null;
        n_users: number;
        n_checkins: number;
        policies: { max_stay: Record<string, number> };
      };
    }, RouteContext<{ id: string }>>(cafeDetailGET, `/api/cafes/${createdCafeId}`, {}, routeParams({ id: createdCafeId }));

    expect(detailRes.status).toBe(200);
    const cafe = detailRes.data;
    expect(cafe.id).toBe(createdCafeId);
    expect(cafe.name).toBe("Orchard Pioneer Roasters");
    expect(cafe.tz).toBe("Asia/Singapore");
    expect(cafe.google_place_id).toBe(pioneerPlaceId);

    // Default anonymity (DG13 / spec 0006): author is null on public read
    expect(cafe.author).toBeNull();
    // Not service-maintained while owned by the original creator
    expect(cafe.maintained_by_service).toBe(false);

    // Gallery verification: photo atomically bound with checkin source; 'by' stripped (DG13)
    expect(cafe.gallery).toHaveLength(1);
    expect(cafe.gallery[0]?.id).toBe(createdPhotoId);
    expect(cafe.gallery[0]?.source).toEqual({
      type: "checkin",
      id: createdCheckinId,
    });
    expect(cafe.gallery[0]?.by).toBeUndefined();

    // Initial aggregate accurately maps creator's single input
    // experience_score: 90, n_users: 1, n_checkins: 1
    // composite_score: 90*0.3 + 80*0.2 + 70*0.2 + 60*0.15 + 95*0.15 = 27 + 16 + 14 + 9 + 14.25 = 80.25
    expect(cafe.work_stats.experience_score).toBe(90);
    expect(cafe.work_stats.n_users).toBe(1);
    expect(cafe.work_stats.n_checkins).toBe(1);
    expect(cafe.work_stats.composite_score).toBeCloseTo(80.25, 2);
    expect(cafe.work_stats.policies.max_stay.unlimited).toBe(1);

    // Read check-in feed via GET /api/cafes/[id]/checkins
    const feedRes = await clientD.get<{
      checkins: Array<{
        id: string;
        scores: { overall: number; wifi: number };
        author: unknown;
        photos: Array<{ id: string; by?: unknown }>;
        max_stay: string;
        note: string;
      }>;
      nextCursor: string | null;
    }, RouteContext<{ id: string }>>(checkinsGET, `/api/cafes/${createdCafeId}/checkins`, {}, routeParams({ id: createdCafeId }));

    expect(feedRes.status).toBe(200);
    expect(feedRes.data.checkins).toHaveLength(1);
    const firstCheckin = feedRes.data.checkins[0]!;
    expect(firstCheckin.id).toBe(createdCheckinId);
    expect(firstCheckin.scores.overall).toBe(90);
    expect(firstCheckin.author).toBeNull();
    expect(firstCheckin.photos).toHaveLength(1);
    expect(firstCheckin.photos[0]?.id).toBe(createdPhotoId);
    expect(firstCheckin.photos[0]?.by).toBeUndefined();

    // Verify newly created cafe appears in GET /api/cafes nearby list (discovery integration)
    const nearbyRes = await clientD.get<{
      cafes: Array<{ id: string; name: string; distance_m: number }>;
    }>(cafesGET, "/api/cafes", {
      query: { lat: 1.3048, lng: 103.8318, radius_km: 10 },
    });
    expect(nearbyRes.status).toBe(200);
    const foundInNearby = nearbyRes.data.cafes.find((c) => c.id === createdCafeId);
    expect(foundInNearby).toBeDefined();
    expect(foundInNearby?.name).toBe("Orchard Pioneer Roasters");
  });

  // =========================================================================
  // 6. Photo Re-use Protection (Edge Case 5 / 400 invalid_photos)
  // =========================================================================

  it("Path 2: POST /api/cafes rejects reused already-consumed photo ID on subsequent creation (Edge Case 5)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // User A uploads valid WebP and creates initial cafe to consume it
    const uploadA = await uploadTestWebP(clientA);
    const initialRes = await clientA.post<{ cafeId: string }>(cafesPOST, "/api/cafes", {
      name: `Initial Photo Cafe ${randomUUID().slice(0, 8)}`,
      lat: 1.3048,
      lng: 103.8318,
      checkin: {
        scores: { overall: 80 },
        max_stay: "2h",
        note: "Initial photo consumption",
        photo_ids: [uploadA.imageUuid],
      },
    });
    expect(initialRes.status).toBe(201);
    createdCafeIds.add(initialRes.data.cafeId);

    // Attempt to reuse uploadA.imageUuid which was consumed in the previous creation
    const reusedRes = await clientA.post(cafesPOST, "/api/cafes", {
      name: "Reused Photo Cafe",
      lat: 1.3100,
      lng: 103.8400,
      checkin: {
        scores: { overall: 75 },
        max_stay: "2h",
        note: "Attempting to double-consume photo ID",
        photo_ids: [uploadA.imageUuid],
      },
    });
    expect(reusedRes.status).toBe(400);
    expect(reusedRes.data).toMatchObject({ error: "invalid_photos" });
  });

  // =========================================================================
  // 7. Deduplication & Collision (409 cafe_exists)
  // =========================================================================

  it("Path 2: POST /api/cafes returns 409 cafe_exists when google_place_id is already registered", async (ctx) => {
    if (!minioUp) return ctx.skip();
    const dupePlaceId = `ChIJORCHARD_DUPE_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const uploadA = await uploadTestWebP(clientA);
    const originalRes = await clientA.post<{ cafeId: string }>(cafesPOST, "/api/cafes", {
      name: "Original Place Venue",
      lat: 1.3048,
      lng: 103.8318,
      google_place_id: dupePlaceId,
      checkin: {
        scores: { overall: 80 },
        max_stay: "2h",
        note: "Original venue",
        photo_ids: [uploadA.imageUuid],
      },
    });
    expect(originalRes.status).toBe(201);
    createdCafeIds.add(originalRes.data.cafeId);

    // User B attempts to create a cafe with the same Google Place ID
    const uploadB = await uploadTestWebP(clientB);
    const dupeRes = await clientB.post<{ error: string; cafe_id: string }>(
      cafesPOST,
      "/api/cafes",
      {
        name: "Duplicate Google Place Venue",
        lat: 1.3048,
        lng: 103.8318,
        google_place_id: dupePlaceId,
        checkin: {
          scores: { overall: 70 },
          max_stay: "3h",
          note: "Collision test",
          photo_ids: [uploadB.imageUuid],
        },
      },
    );

    expect(dupeRes.status).toBe(409);
    expect(dupeRes.data.error).toBe("cafe_exists");
    expect(dupeRes.data.cafe_id).toBe(originalRes.data.cafeId);
  });

  // =========================================================================
  // 8. International Timezone Derivations (Tokyo & London)
  // =========================================================================

  it("Path 2: timezone accurately derives from coordinates across international locations (Tokyo & London)", async (ctx) => {
    if (!minioUp) return ctx.skip();
    // User B creates Tokyo cafe (35.6580, 139.7016)
    const uploadTokyo = await uploadTestWebP(clientB);
    const tokyoRes = await clientB.post<{ cafeId: string; tz: string }>(
      cafesPOST,
      "/api/cafes",
      {
        name: "Shibuya Work Lab",
        lat: 35.6580,
        lng: 139.7016,
        city: "tokyo",
        google_place_id: "ChIJTOKYOSHIBUYA01",
        checkin: {
          scores: { overall: 85, wifi: 90 },
          max_stay: "3h",
          note: "Quiet spot in Shibuya",
          photo_ids: [uploadTokyo.imageUuid],
        },
      },
    );
    expect(tokyoRes.status).toBe(201);
    expect(tokyoRes.data.tz).toBe("Asia/Tokyo");
    createdCafeIds.add(tokyoRes.data.cafeId);

    // User C creates London cafe (51.5133, -0.1364)
    const uploadLondon = await uploadTestWebP(clientC);
    const londonRes = await clientC.post<{ cafeId: string; tz: string }>(
      cafesPOST,
      "/api/cafes",
      {
        name: "Soho Work Studio",
        lat: 51.5133,
        lng: -0.1364,
        city: "london",
        google_place_id: "ChIJLONDONSOHO01",
        checkin: {
          scores: { overall: 80, wifi: 85 },
          max_stay: "2h",
          note: "Central London study cafe",
          photo_ids: [uploadLondon.imageUuid],
        },
      },
    );
    expect(londonRes.status).toBe(201);
    expect(londonRes.data.tz).toBe("Europe/London");
    createdCafeIds.add(londonRes.data.cafeId);
  });
});
