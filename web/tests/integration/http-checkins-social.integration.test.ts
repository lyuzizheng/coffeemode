/**
 * HTTP User Journey Matrix — Paths 4 & 5: Check-ins, Revisit, Idempotency & Social Likes (Stage 2 - Slice 2D)
 *
 * Spec reference: docs/specs/0008-http-user-journey-matrix.md (§7, §8 & §13 Slice 2D)
 *
 * Exercises product-visible behavior strictly through Next.js App Router route handlers
 * using the Stage 1 ApiClient harness (web/tests/helpers/http-client.ts).
 *
 * Runs under RUN_INTEGRATION=1 against real PostGIS Postgres (CI integration-gate).
 * Self-skips when RUN_INTEGRATION is unset so standard npm test stays green.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Install the process-global auth mock BEFORE importing any route handlers.
vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { GET as healthGET } from "@/app/api/health/route";
import { POST as checkinPOST } from "@/app/api/checkins/route";
import { GET as lastCheckinGET } from "@/app/api/checkins/last/route";
import { PATCH as checkinPATCH } from "@/app/api/checkins/[id]/route";
import { POST as likePOST } from "@/app/api/checkins/[id]/like/route";
import { GET as feedGET } from "@/app/api/cafes/[id]/checkins/route";
import { GET as cafeGET } from "@/app/api/cafes/[id]/route";

import {
  apiClient,
  createHttpTestUsers,
  routeParams,
  seedHttpTestUsers,
  type ApiClient,
  type ApiResponse,
  type HttpRequestOptions,
  type HttpTestUsers,
} from "../helpers/http-client";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { rateLimiter } from "@/lib/rate-limit";
import {
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
  testDatabaseUrl,
} from "../helpers/db";
import { MOCK_CAFES, seedMockDataset } from "../fixtures/mock-dataset";
import type { PublicCafeDetail } from "@/types/cafes";
import type { CheckInFeedPage, CheckInScores, MaxStay } from "@/types/checkins";
import type { ToggleLikeResult } from "@/lib/db/checkins";
import { encodeFeedCursor } from "@/lib/discovery/feed";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeCheckinsSocial = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_http_checkins_social");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
let users!: HttpTestUsers;
const previousDatabaseUrl = process.env.DATABASE_URL;

let cafe1Id = "";
let cafe2Id = "";
let cafe3Id = "";
let cafe4Id = "";
let cafe5Id = "";
let userACheckinId = "";
let userBCheckinId = "";
let userCCheckinId = "";

/** Harness-owned rate limit reset: clears memory bucket + Postgres rate_limits table (§1). */
async function resetRateLimits(): Promise<void> {
  await rateLimiter.reset();
  if (dbClient) {
    await dbClient.query("truncate table rate_limits");
  }
}

// ---------------------------------------------------------------------------
// Typed Route Helpers invoking ApiClient
// ---------------------------------------------------------------------------

async function callHealth(
  client: ApiClient = apiClient(),
): Promise<ApiResponse<{ ok: boolean; version: string; boot_time: string }>> {
  return client.call(async () => healthGET(), "GET", "/api/health");
}

async function postCheckin(
  client: ApiClient,
  body: unknown,
  options?: HttpRequestOptions,
): Promise<ApiResponse<{ checkinId?: string; error?: string; existing_checkin_id?: string; message?: string }>> {
  return client.call(checkinPOST, "POST", "/api/checkins", { ...options, body });
}

async function getLastCheckin(
  client: ApiClient,
  query?: Record<string, string>,
): Promise<
  ApiResponse<{
    checkin: {
      id: string;
      scores: CheckInScores;
      max_stay: MaxStay | null;
      note: string | null;
    } | null;
    revisitWindowHours: number;
    error?: string;
  }>
> {
  return client.call(lastCheckinGET, "GET", "/api/checkins/last", { query });
}

async function patchCheckin(
  client: ApiClient,
  id: string,
  body: unknown,
  options?: HttpRequestOptions,
): Promise<ApiResponse<{ cafeId?: string; error?: string }>> {
  return client.call(checkinPATCH, "PATCH", `/api/checkins/${id}`, { ...options, body }, routeParams({ id }));
}

async function postLike(
  client: ApiClient,
  id: string,
  options?: HttpRequestOptions,
): Promise<ApiResponse<ToggleLikeResult & { error?: string }>> {
  return client.call(likePOST, "POST", `/api/checkins/${id}/like`, options, routeParams({ id }));
}

async function getFeed(
  client: ApiClient,
  id: string,
  query?: Record<string, string>,
): Promise<ApiResponse<CheckInFeedPage & { error?: string; message?: string }>> {
  return client.call(feedGET, "GET", `/api/cafes/${id}/checkins`, { query }, routeParams({ id }));
}

async function getCafeDetail(
  client: ApiClient,
  id: string,
): Promise<ApiResponse<PublicCafeDetail & { error?: string }>> {
  return client.call(cafeGET, "GET", `/api/cafes/${id}`, {}, routeParams({ id }));
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describeCheckinsSocial("HTTP User Journey — Paths 4 & 5: Check-ins, Revisit & Likes (spec 0008)", () => {
  beforeAll(async () => {
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();

    await dbClient.query(
      "truncate table profiles, cafes, rate_limits, image_upload_intents, navigations restart identity cascade",
    );

    users = createHttpTestUsers();
    await seedHttpTestUsers(dbClient, users);
    await seedMockDataset(dbClient);

    cafe1Id = MOCK_CAFES[0]!.id;
    cafe2Id = MOCK_CAFES[1]!.id;
    cafe3Id = MOCK_CAFES[2]!.id;
    cafe4Id = MOCK_CAFES[3]!.id;
    cafe5Id = MOCK_CAFES[4]!.id;
  }, 120_000);
  afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await closePool();
    } catch (error) {
      errors.push(error);
    }
    try {
      await dbClient?.end();
    } catch (error) {
      errors.push(error);
    }
    if (RUN_INTEGRATION && testDbUrl) {
      const admin = new pg.Client(getPoolConfig(adminDbUrl));
      try {
        await admin.connect();
        await admin.query(`drop database if exists ${quotedIdentifier(TEST_DB)} with (force)`);
      } catch (error) {
        errors.push(error);
      } finally {
        try {
          await admin.end();
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;

    if (errors.length > 0) {
      throw new AggregateError(errors, "http checkins-social integration cleanup failed");
    }
  });

  beforeEach(async () => {
    await resetRateLimits();
  });

  // =========================================================================
  // Smoke & Liveness
  // =========================================================================

  it("Path 4: GET /api/health confirms API liveness smoke (spec 0008 §11)", async () => {
    const res = await callHealth();
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
  });

  // =========================================================================
  // Path 4: Check-in Creation Contract & Validation (§7)
  // =========================================================================

  describe("Path 4: check-in creation contract and validation (spec 0008 §7)", () => {
    it("Path 4: rejects unauthenticated check-in with 401 unauthorized (spec 0008 §7)", async () => {
      const res = await postCheckin(apiClient(), {
        cafe_id: cafe1Id,
        scores: { overall: 80 },
      });
      expect(res.status).toBe(401);
      expect(res.data.error).toBe("unauthorized");
    });

    it("Path 4: rejects cross-site origin with 403 forbidden_origin (spec 0008 §11)", async () => {
      const res = await postCheckin(
        apiClient(users.userA),
        { cafe_id: cafe1Id, scores: { overall: 80 } },
        { headers: { origin: "https://evil.example" } },
      );
      expect(res.status).toBe(403);
      expect(res.data.error).toBe("forbidden_origin");
    });

    it("Path 4: validates required cafe_id format and presence (400 invalid_request)", async () => {
      const missingCafe = await postCheckin(apiClient(users.userA), {
        scores: { overall: 80 },
      });
      expect(missingCafe.status).toBe(400);
      expect(missingCafe.data.error).toBe("invalid_request");

      const invalidCafe = await postCheckin(apiClient(users.userA), {
        cafe_id: "not-a-uuid",
        scores: { overall: 80 },
      });
      expect(invalidCafe.status).toBe(400);
      expect(invalidCafe.data.error).toBe("invalid_request");
    });

    it("Path 4: validates scores payload bounds and dimension presence (400 invalid_request)", async () => {
      const missingScores = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
      });
      expect(missingScores.status).toBe(400);
      expect(missingScores.data.error).toBe("invalid_request");

      const emptyScores = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: {},
      });
      expect(emptyScores.status).toBe(400);
      expect(emptyScores.data.error).toBe("invalid_request");

      const invalidDim = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { invalid_dim: 80 },
      });
      expect(invalidDim.status).toBe(400);
      expect(invalidDim.data.error).toBe("invalid_request");

      const outOfRange = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 120 },
      });
      expect(outOfRange.status).toBe(400);
      expect(outOfRange.data.error).toBe("invalid_request");

      const negativeScore = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: -5 },
      });
      expect(negativeScore.status).toBe(400);
      expect(negativeScore.data.error).toBe("invalid_request");
    });

    it("Path 4: validates max_stay, note length, and future visited_at (400 invalid_request)", async () => {
      const invalidStay = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 80 },
        max_stay: "forever",
      });
      expect(invalidStay.status).toBe(400);
      expect(invalidStay.data.error).toBe("invalid_request");

      const noteTooLong = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 80 },
        note: "a".repeat(501),
      });
      expect(noteTooLong.status).toBe(400);
      expect(noteTooLong.data.error).toBe("invalid_request");

      const futureVisit = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 80 },
        visited_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(futureVisit.status).toBe(400);
      expect(futureVisit.data.error).toBe("invalid_request");
    });

    it("Path 4: validates photo_ids bounds, format, and uniqueness (400 invalid_request)", async () => {
      const nonUuidPhoto = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 80 },
        photo_ids: ["not-a-uuid"],
      });
      expect(nonUuidPhoto.status).toBe(400);
      expect(nonUuidPhoto.data.error).toBe("invalid_request");

      const dupePhotoId = randomUUID();
      const duplicatePhotos = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 80 },
        photo_ids: [dupePhotoId, dupePhotoId],
      });
      expect(duplicatePhotos.status).toBe(400);
      expect(duplicatePhotos.data.error).toBe("invalid_request");

      const tooManyPhotos = Array.from({ length: 7 }, () => randomUUID());
      const overPhotoCap = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 80 },
        photo_ids: tooManyPhotos,
      });
      expect(overPhotoCap.status).toBe(400);
      expect(overPhotoCap.data.error).toBe("invalid_request");
    });

    it("Path 4: returns 404 not_found for non-existent cafe UUID (spec 0008 §7)", async () => {
      const nonExistentCafeId = randomUUID();
      const res = await postCheckin(apiClient(users.userA), {
        cafe_id: nonExistentCafeId,
        scores: { overall: 80 },
      });
      expect(res.status).toBe(404);
      expect(res.data.error).toBe("not_found");
    });

    it("Path 4: multi-user check-ins each contribute one weighted vote to work_stats (spec 0008 §7, §10)", async () => {
      // User A check-in: overall 90, wifi 90, outlets 80, seats 70, temp 60, coffee 95
      const resA = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe1Id,
        scores: { overall: 90, wifi: 90, outlets: 80, seats: 70, temp: 60, coffee: 95 },
        max_stay: "unlimited",
        note: "A creator perspective",
      });
      expect(resA.status).toBe(201);
      expect(typeof resA.data.checkinId).toBe("string");
      userACheckinId = resA.data.checkinId!;

      // User B check-in: all dimensions 60, max_stay: 3h
      const resB = await postCheckin(apiClient(users.userB), {
        cafe_id: cafe1Id,
        scores: { overall: 60, wifi: 60, outlets: 60, seats: 60, temp: 60, coffee: 60 },
        max_stay: "3h",
        note: "B explorer perspective",
      });
      expect(resB.status).toBe(201);
      expect(typeof resB.data.checkinId).toBe("string");
      userBCheckinId = resB.data.checkinId!;

      // User C check-in: all dimensions 75, max_stay: 2h
      const resC = await postCheckin(apiClient(users.userC), {
        cafe_id: cafe1Id,
        scores: { overall: 75, wifi: 75, outlets: 75, seats: 75, temp: 75, coffee: 75 },
        max_stay: "2h",
        note: "C visitor perspective",
      });
      expect(resC.status).toBe(201);
      expect(typeof resC.data.checkinId).toBe("string");
      userCCheckinId = resC.data.checkinId!;

      // Independent observer User D audits the aggregated cafe detail through GET /api/cafes/[id]
      const detailRes = await getCafeDetail(apiClient(users.userD), cafe1Id);
      expect(detailRes.status).toBe(200);
      const stats = detailRes.data.work_stats;

      expect(stats.n_checkins).toBe(3);
      expect(stats.n_users).toBe(3);

      // spec 0008 §10 ledger:
      // experience_score = mean(90, 60, 75) = 75
      expect(stats.experience_score).toBeCloseTo(75, 2);

      // composite_score:
      // wifi: (90 + 60 + 75)/3 = 75 * 0.30 = 22.5
      // outlets: (80 + 60 + 75)/3 = 71.6667 * 0.20 = 14.3333
      // seats: (70 + 60 + 75)/3 = 68.3333 * 0.20 = 13.6667
      // temp: (60 + 60 + 75)/3 = 65 * 0.15 = 9.75
      // coffee: (95 + 60 + 75)/3 = 76.6667 * 0.15 = 11.5
      // sum = 22.5 + 14.3333 + 13.6667 + 9.75 + 11.5 = 71.75
      expect(stats.composite_score).toBeCloseTo(71.75, 2);

      // Consensus policies: { unlimited: 1, 3h: 1, 2h: 1 }
      expect(stats.policies.max_stay).toEqual({
        unlimited: 1,
        "3h": 1,
        "2h": 1,
      });
    });
  });

  // =========================================================================
  // Path 4: DG64 24h Revisit & Edit Flow (§7)
  // =========================================================================

  describe("Path 4: DG64 24h revisit edit flow (spec 0008 §7)", () => {
    it("Path 4: DG64 second check-in within 24h returns 409 duplicate_checkin with existing_checkin_id", async () => {
      // User B checks in again at Cafe 1 inside 24h window
      const res = await postCheckin(apiClient(users.userB), {
        cafe_id: cafe1Id,
        scores: { overall: 95 },
        note: "trying to create duplicate",
      });
      expect(res.status).toBe(409);
      expect(res.data.error).toBe("duplicate_checkin");
      expect(res.data.existing_checkin_id).toBe(userBCheckinId);
    });

    it("Path 4: DG64 GET /api/checkins/last returns caller's existing check-in and live revisit window", async () => {
      // Anonymous read returns 401
      const anonRes = await getLastCheckin(apiClient(), { cafe_id: cafe1Id });
      expect(anonRes.status).toBe(401);
      expect(anonRes.data.error).toBe("unauthorized");

      // Missing or invalid cafe_id returns 400
      const missingCafeRes = await getLastCheckin(apiClient(users.userB));
      expect(missingCafeRes.status).toBe(400);
      expect(missingCafeRes.data.error).toBe("invalid_request");

      const invalidCafeRes = await getLastCheckin(apiClient(users.userB), { cafe_id: "not-a-uuid" });
      expect(invalidCafeRes.status).toBe(400);
      expect(invalidCafeRes.data.error).toBe("invalid_request");

      // User B retrieves their own last check-in: returns record + revisitWindowHours: 24
      const resB = await getLastCheckin(apiClient(users.userB), { cafe_id: cafe1Id });

      expect(resB.status).toBe(200);
      expect(resB.data.revisitWindowHours).toBe(24);
      expect(resB.data.checkin).not.toBeNull();
      expect(resB.data.checkin?.id).toBe(userBCheckinId);
      expect(resB.data.checkin?.scores.overall).toBe(60);
      expect(resB.data.checkin?.max_stay).toBe("3h");
      expect(resB.data.checkin?.note).toBe("B explorer perspective");

      // User D (who never checked in to Cafe 1) gets checkin: null
      const resD = await getLastCheckin(apiClient(users.userD), { cafe_id: cafe1Id });

      expect(resD.status).toBe(200);
      expect(resD.data.checkin).toBeNull();
      expect(resD.data.revisitWindowHours).toBe(24);
    });

    it("Path 4: DG64 client converts to PATCH /api/checkins/[id] with auth and author guards", async () => {
      // Anonymous PATCH returns 401
      const anonPatch = await patchCheckin(apiClient(), userBCheckinId, { scores: { overall: 70 } });
      expect(anonPatch.status).toBe(401);
      expect(anonPatch.data.error).toBe("unauthorized");

      // Cross-origin PATCH returns 403
      const evilPatch = await patchCheckin(
        apiClient(users.userB),
        userBCheckinId,
        { scores: { overall: 70 } },
        { headers: { origin: "https://evil.example" } },
      );
      expect(evilPatch.status).toBe(403);
      expect(evilPatch.data.error).toBe("forbidden_origin");

      // Invalid UUID returns 400
      const invalidIdPatch = await patchCheckin(apiClient(users.userB), "invalid-uuid", {
        scores: { overall: 70 },
      });
      expect(invalidIdPatch.status).toBe(400);
      expect(invalidIdPatch.data.error).toBe("invalid_request");

      // Non-existent check-in returns 404
      const nonExistentId = randomUUID();
      const missingPatch = await patchCheckin(apiClient(users.userB), nonExistentId, {
        scores: { overall: 70 },
      });
      expect(missingPatch.status).toBe(404);
      expect(missingPatch.data.error).toBe("not_found");

      // Non-author PATCH (User C trying to update User B's check-in) returns 403 forbidden
      const forbiddenPatch = await patchCheckin(apiClient(users.userC), userBCheckinId, {
        scores: { overall: 70 },
      });
      expect(forbiddenPatch.status).toBe(403);
      expect(forbiddenPatch.data.error).toBe("forbidden");
    });

    it("Path 4: DG64 author PATCH updates check-in and recomputes cafe aggregate dynamically (spec 0008 §7)", async () => {
      // User B executes legitimate edit: overall moves 60 -> 70, note replaced, max_stay: null clears policy
      const patchRes = await patchCheckin(apiClient(users.userB), userBCheckinId, {
        scores: { overall: 70, wifi: 60, outlets: 60, seats: 60, temp: 60, coffee: 60 },
        note: "B revised note after second visit",
        max_stay: null,
      });
      expect(patchRes.status).toBe(200);
      expect(patchRes.data.cafeId).toBe(cafe1Id);

      // Audit cafe detail via User D: exactly 1 live row for User B remains, experience score recomputed
      const detailRes = await getCafeDetail(apiClient(users.userD), cafe1Id);
      expect(detailRes.status).toBe(200);
      const stats = detailRes.data.work_stats;

      expect(stats.n_checkins).toBe(3);
      expect(stats.n_users).toBe(3);

      // spec 0008 §10: After Act 4 (B edit):
      // experience_score = mean(90, 70, 75) = 235 / 3 = 78.33
      expect(stats.experience_score).toBeCloseTo(78.33, 2);

      // composite_score remains 71.75 because dimension scores were not touched
      expect(stats.composite_score).toBeCloseTo(71.75, 2);

      // max_stay for 3h was cleared; now only unlimited: 1 and 2h: 1 remain
      expect(stats.policies.max_stay).toEqual({
        unlimited: 1,
        "2h": 1,
      });

      // Confirm User B's last check-in reflects the edit
      const lastRes = await getLastCheckin(apiClient(users.userB), { cafe_id: cafe1Id });
      expect(lastRes.status).toBe(200);
      expect(lastRes.data.checkin?.scores.overall).toBe(70);
      expect(lastRes.data.checkin?.note).toBe("B revised note after second visit");
      expect(lastRes.data.checkin?.max_stay).toBeNull();
    });
  });

  // =========================================================================
  // Path 4: 25h Window Expiry & Recency-Decay Weighting (§7)
  // =========================================================================

  describe("Path 4: 25h window-expiry and recency-decay weighting (spec 0008 §7)", () => {
    it("Path 4: DG64 25h window expiry creates independent second record and applies 0.6 decay (spec 0008 §7)", async () => {
      // Use clean Cafe 2 (Tokyo)
      // First check-in by User A backdated to 25 hours ago: overall 60
      const past25h = new Date(Date.now() - 25 * 3_600_000).toISOString();
      const firstRes = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe2Id,
        scores: { overall: 60 },
        note: "Day 1 visit 25 hours ago",
        visited_at: past25h,
      });
      expect(firstRes.status).toBe(201);
      const firstCheckinId = firstRes.data.checkinId;

      // Second check-in by User A now (visited_at current): overall 80
      // Because > 24 hours have elapsed, this is a NEW check-in (201), NOT a 409 conflict
      const secondRes = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe2Id,
        scores: { overall: 80 },
        note: "Day 2 visit today",
      });
      expect(secondRes.status).toBe(201);
      const secondCheckinId = secondRes.data.checkinId;
      expect(secondCheckinId).not.toBe(firstCheckinId);

      // Verify aggregate via User D:
      // Both check-ins are live rows (n_checkins: 2), but only 1 user (n_users: 1).
      // Recency-weighted mean with decay 0.6:
      // rank 0 (newest, overall 80): weight 1.0 -> 80 * 1.0 = 80
      // rank 1 (older, overall 60): weight 0.6 -> 60 * 0.6 = 36
      // weighted mean = (80 + 36) / (1.0 + 0.6) = 116 / 1.6 = 72.5
      const detailRes = await getCafeDetail(apiClient(users.userD), cafe2Id);
      expect(detailRes.status).toBe(200);
      const stats = detailRes.data.work_stats;

      expect(stats.n_checkins).toBe(2);
      expect(stats.n_users).toBe(1);
      expect(stats.experience_score).toBeCloseTo(72.5, 2);
    });
  });

  // =========================================================================
  // Path 4: DG61 Idempotency Key Replay & Precedence (§7)
  // =========================================================================

  describe("Path 4: DG61 idempotency key replay and precedence (spec 0008 §7)", () => {
    it("Path 4: DG61 validates idempotency_key UUID format (400 invalid_request)", async () => {
      const res = await postCheckin(apiClient(users.userC), {
        cafe_id: cafe3Id,
        scores: { overall: 85 },
        idempotency_key: "not-a-valid-uuid",
      });
      expect(res.status).toBe(400);
      expect(res.data.error).toBe("invalid_request");
    });

    it("Path 4: DG61 replaying same idempotency_key returns original checkinId with 200 without duplicate row", async () => {
      // Use clean Cafe 3 (London)
      const idempotencyKey = randomUUID();

      // First POST: fresh write with idempotency_key -> 201
      const firstRes = await postCheckin(apiClient(users.userC), {
        cafe_id: cafe3Id,
        scores: { overall: 85 },
        note: "original payload",
        idempotency_key: idempotencyKey,
      });
      expect(firstRes.status).toBe(201);
      const initialId = firstRes.data.checkinId;
      expect(typeof initialId).toBe("string");

      // Second POST (retry/replay): same idempotency_key, different payload
      // Returns 200 (not 201), with the SAME checkinId, without inserting a new row
      const replayRes = await postCheckin(apiClient(users.userC), {
        cafe_id: cafe3Id,
        scores: { overall: 40 },
        note: "retried payload with different values",
        idempotency_key: idempotencyKey,
      });
      expect(replayRes.status).toBe(200);
      expect(replayRes.data.checkinId).toBe(initialId);

      // Verify feed: exactly 1 check-in exists, and original payload won
      const feedRes = await getFeed(apiClient(), cafe3Id);
      expect(feedRes.status).toBe(200);
      expect(feedRes.data.checkins).toHaveLength(1);
      expect(feedRes.data.checkins[0]?.id).toBe(initialId);
      expect(feedRes.data.checkins[0]?.note).toBe("original payload");
      expect(feedRes.data.checkins[0]?.scores.overall).toBe(85);
    });

    it("Path 4: DG61 idempotency replay takes precedence over DG64 24h revisit check (returns 200, not 409)", async () => {
      // Verify replay precedence on Cafe 4 with a fresh user/key:
      const precedenceKey = randomUUID();
      const createRes = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe4Id,
        scores: { overall: 88 },
        idempotency_key: precedenceKey,
      });
      expect(createRes.status).toBe(201);
      const createdId = createRes.data.checkinId;

      // Replay identical key inside 24h: must return 200 (replay), NOT 409 (revisit conflict)
      const replayRes = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe4Id,
        scores: { overall: 88 },
        idempotency_key: precedenceKey,
      });
      expect(replayRes.status).toBe(200);
      expect(replayRes.data.checkinId).toBe(createdId);

      // In contrast, posting with a DIFFERENT key inside 24h triggers 409 duplicate_checkin
      const differentKeyRes = await postCheckin(apiClient(users.userA), {
        cafe_id: cafe4Id,
        scores: { overall: 88 },
        idempotency_key: randomUUID(),
      });
      expect(differentKeyRes.status).toBe(409);
      expect(differentKeyRes.data.error).toBe("duplicate_checkin");
    });
  });

  // =========================================================================
  // Path 4: Feed Ordering, Keyset Pagination & Cursors (§7)
  // =========================================================================

  describe("Path 4: Feed stream ordering, cursors, and cross-mode validation (spec 0008 §7)", () => {
    it("Path 4: feed returns 404 for non-existent cafe UUID", async () => {
      const nonExistentCafeId = randomUUID();
      const res = await getFeed(apiClient(), nonExistentCafeId);
      expect(res.status).toBe(404);
      expect(res.data.error).toBe("not_found");
    });

    it("Path 4: feed rejects unknown mode with 400 listing valid modes (DG113)", async () => {
      const res = await getFeed(apiClient(), cafe1Id, { mode: "invalid_mode" });
      expect(res.status).toBe(400);
      expect(res.data.error).toBe("invalid_request");
      expect(res.data.message).toMatch(/newest.*helpful/i);
    });

    it("Path 4: feed defaults to newest mode ordering by visited_at desc (DG113)", async () => {
      // Cafe 1 has 3 check-ins from Users A, B, C
      const res = await getFeed(apiClient(), cafe1Id);
      expect(res.status).toBe(200);
      expect(res.data.checkins.length).toBeGreaterThanOrEqual(3);

      const cafe1Ids = new Set(res.data.checkins.map((c) => c.id));
      expect(cafe1Ids.has(userACheckinId)).toBe(true);
      expect(cafe1Ids.has(userCCheckinId)).toBe(true);

      // Verify descending timestamp order
      const checkins = res.data.checkins;
      for (let i = 1; i < checkins.length; i += 1) {
        const prev = new Date(checkins[i - 1]!.visited_at).getTime();
        const curr = new Date(checkins[i]!.visited_at).getTime();
        expect(curr).toBeLessThanOrEqual(prev);
      }
    });

    it("Path 4: feed keyset pagination pages with nextCursor and terminates with null", async () => {
      // Dedicated Cafe 5: add 22 backdated check-ins (> pageSize 20)
      // All backdated (>48h ago) using User A so none conflict with the 24h revisit window.
      for (let i = 0; i < 22; i += 1) {
        if (i % 5 === 0) await resetRateLimits();
        const past = new Date(Date.now() - (48 + i * 2) * 3_600_000).toISOString();
        const addRes = await postCheckin(apiClient(users.userA), {
          cafe_id: cafe5Id,
          scores: { overall: 70 },
          note: `Pagination check-in #${i}`,
          visited_at: past,
        });
        expect(addRes.status).toBe(201);
      }

      await resetRateLimits();

      // Page 1: default mode (newest), must return exactly 20 rows + string nextCursor
      const page1Res = await getFeed(apiClient(), cafe5Id);
      expect(page1Res.status).toBe(200);
      expect(page1Res.data.checkins).toHaveLength(20);
      expect(typeof page1Res.data.nextCursor).toBe("string");
      const cursor = page1Res.data.nextCursor!;

      // Page 2: pass cursor -> returns remaining 2 rows + nextCursor: null
      const page2Res = await getFeed(apiClient(), cafe5Id, { cursor });
      expect(page2Res.status).toBe(200);
      expect(page2Res.data.checkins).toHaveLength(2);
      expect(page2Res.data.nextCursor).toBeNull();

      // Ensure page 1 and page 2 are disjoint
      const page1Ids = new Set(page1Res.data.checkins.map((c) => c.id));
      for (const item of page2Res.data.checkins) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
    });

    it("Path 4: cross-mode cursor returns 400 invalid_request (spec 0008 §7)", async () => {
      // Build a cursor issued for "newest" mode
      const newestCursor = encodeFeedCursor({
        v: 1,
        mode: "newest",
        visited_at: new Date().toISOString(),
        id: randomUUID(),
      });

      // Passing newestCursor to mode=helpful must be rejected with 400
      const rejectedHelpful = await getFeed(apiClient(), cafe1Id, {
        mode: "helpful",
        cursor: newestCursor,
      });
      expect(rejectedHelpful.status).toBe(400);
      expect(rejectedHelpful.data.error).toBe("invalid_request");

      // Build a cursor issued for "helpful" mode
      const helpfulCursor = encodeFeedCursor({
        v: 1,
        mode: "helpful",
        likes: 2,
        visited_at: new Date().toISOString(),
        id: randomUUID(),
      });

      // Passing helpfulCursor to mode=newest must be rejected with 400
      const rejectedNewest = await getFeed(apiClient(), cafe1Id, {
        mode: "newest",
        cursor: helpfulCursor,
      });
      expect(rejectedNewest.status).toBe(400);
      expect(rejectedNewest.data.error).toBe("invalid_request");
    });
  });

  // =========================================================================
  // Path 5: Social Likes and Constraints (§8)
  // =========================================================================

  describe("Path 5: Social likes and constraints (spec 0008 §8)", () => {
    it("Path 5: rejects anonymous like with 401 unauthorized (spec 0008 §8)", async () => {
      const res = await postLike(apiClient(), userBCheckinId);
      expect(res.status).toBe(401);
      expect(res.data.error).toBe("unauthorized");
    });

    it("Path 5: rejects cross-site origin like with 403 forbidden_origin (spec 0008 §11)", async () => {
      const res = await postLike(apiClient(users.userA), userBCheckinId, {
        headers: { origin: "https://evil.example" },
      });
      expect(res.status).toBe(403);
      expect(res.data.error).toBe("forbidden_origin");
    });

    it("Path 5: validates checkin ID format (400 invalid_request) and presence (404 not_found)", async () => {
      const invalidIdRes = await postLike(apiClient(users.userA), "not-a-uuid");
      expect(invalidIdRes.status).toBe(400);
      expect(invalidIdRes.data.error).toBe("invalid_request");

      const nonExistentCheckinId = randomUUID();
      const notFoundRes = await postLike(apiClient(users.userA), nonExistentCheckinId);
      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.data.error).toBe("not_found");
    });

    it("Path 5: blocks self-like with 403 self_like_forbidden (spec 0004 D8 / DG08)", async () => {
      // User B attempts to like User B's own check-in -> 403 self_like_forbidden
      const res = await postLike(apiClient(users.userB), userBCheckinId);
      expect(res.status).toBe(403);
      expect(res.data.error).toBe("self_like_forbidden");
    });

    it("Path 5: like toggle symmetrically increments and decrements likes_count (spec 0008 §8)", async () => {
      // User A likes User B's check-in: liked true, count 1
      const like1 = await postLike(apiClient(users.userA), userBCheckinId);
      expect(like1.status).toBe(200);
      expect(like1.data).toEqual({ liked: true, likesCount: 1 });

      // User A un-likes User B's check-in (toggle): liked false, count 0
      const unlike1 = await postLike(apiClient(users.userA), userBCheckinId);
      expect(unlike1.status).toBe(200);
      expect(unlike1.data).toEqual({ liked: false, likesCount: 0 });

      // User A re-likes: liked true, count 1
      const relike1 = await postLike(apiClient(users.userA), userBCheckinId);
      expect(relike1.status).toBe(200);
      expect(relike1.data).toEqual({ liked: true, likesCount: 1 });

      // User C also likes User B's check-in: liked true, count 2
      const like2 = await postLike(apiClient(users.userC), userBCheckinId);
      expect(like2.status).toBe(200);
      expect(like2.data).toEqual({ liked: true, likesCount: 2 });
    });

    it("Path 5: helpful feed mode ranks check-ins by likes_count desc (spec 0008 §7)", async () => {
      // In Cafe 1, User B's check-in now has likes_count: 2 (User A and User C liked it)
      // User A's and User C's check-ins have 0 likes
      const helpfulRes = await getFeed(apiClient(), cafe1Id, { mode: "helpful" });
      expect(helpfulRes.status).toBe(200);
      expect(helpfulRes.data.checkins[0]?.id).toBe(userBCheckinId);
      expect(helpfulRes.data.checkins[0]?.likes_count).toBe(2);
    });

    it("Path 5: isolates liked_by_viewer per caller perspective (spec 0008 §8)", async () => {
      // User A liked User B's check-in -> sees liked_by_viewer: true
      const feedResA = await getFeed(apiClient(users.userA), cafe1Id);
      const itemA = feedResA.data.checkins.find((c) => c.id === userBCheckinId);
      expect(itemA?.liked_by_viewer).toBe(true);

      // User C liked User B's check-in -> sees liked_by_viewer: true
      const feedResC = await getFeed(apiClient(users.userC), cafe1Id);
      const itemC = feedResC.data.checkins.find((c) => c.id === userBCheckinId);
      expect(itemC?.liked_by_viewer).toBe(true);

      // User D (authenticated but never liked) -> sees liked_by_viewer: false
      const feedResD = await getFeed(apiClient(users.userD), cafe1Id);
      const itemD = feedResD.data.checkins.find((c) => c.id === userBCheckinId);
      expect(itemD?.liked_by_viewer).toBe(false);

      // Anonymous viewer -> sees liked_by_viewer: false
      const feedResAnon = await getFeed(apiClient(), cafe1Id);
      const itemAnon = feedResAnon.data.checkins.find((c) => c.id === userBCheckinId);
      expect(itemAnon?.liked_by_viewer).toBe(false);
    });
  });
});
