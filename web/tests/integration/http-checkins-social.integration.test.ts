/**
 * @vitest-environment node
 * Path 4+5: Check-ins, 24h Revisit, Idempotency & Social Likes HTTP Suite (BRAWUKA-159 / Slice 2D)
 * Spec reference: docs/specs/0008-http-user-journey-matrix.md (§7, §8 & §13 Slice 2D)
 *
 * Runs against real Postgres/PostGIS and real MinIO when RUN_INTEGRATION=1.
 * All product behavior is driven through external HTTP Route Handlers via
 * web/tests/helpers/http-client.ts. Cafes are bootstrapped through
 * POST /api/cafes (HTTP-only fixtures); aggregates are reconciled through
 * User D's GET reads, never through direct database access. The only
 * database touchpoints are harness-owned infrastructure: persona
 * provisioning (seedHttpTestUsers, incl. the fifth feed-pagination persona E)
 * and rate-limit bucket resets.
 * Seam note: spec §14 lists no mock seam for Paths 4/5, but this slice
 * bootstraps cafes through POST /api/cafes, which mandates 1–6 provisioned
 * photos — so the image-service client module mock below is the §5
 * preference-order fallback (real worker when the gate provides it, else a
 * seam-only mock of the image client; route handlers stay real).
  */

import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cafesPOST } from "@/app/api/cafes/route";
import { GET as cafeDetailGET } from "@/app/api/cafes/[id]/route";
import { GET as feedGET } from "@/app/api/cafes/[id]/checkins/route";
import { POST as checkinsPOST } from "@/app/api/checkins/route";
import { GET as checkinsLastGET } from "@/app/api/checkins/last/route";
import { PATCH as checkinPATCH } from "@/app/api/checkins/[id]/route";
import { POST as likePOST } from "@/app/api/checkins/[id]/like/route";
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
import { createTestSessionUser } from "../helpers/mocks";

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
const describeHttp = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_http_checkins");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const cleanupErrors: string[] = [];
const previousDatabaseUrl = process.env.DATABASE_URL;

const users = createHttpTestUsers();
// Fifth persona for feed pagination (spec §2 fixes four; E is slice-local):
// the cafe creator's fresh creation check-in sits inside the DG64 window, so
// the creator cannot author backdated feed visits — E absorbs the third
// rotation slot. Provisioned via the harness seeder in beforeAll, never SQL.
const userE = createTestSessionUser({
  id: "c0000000-0000-4000-a000-0000000000a5",
  displayName: "HTTP Erin",
  currentCity: "singapore",
});
const clientA = apiClient(users.userA);
const clientB = apiClient(users.userB);
const clientC = apiClient(users.userC);
const clientD = apiClient(users.userD);
const clientE = apiClient(userE);
const guestClient = apiClient().asGuest();

// ——— Response DTOs (external HTTP contract shapes) ———

interface CafeDetailDTO {
  id: string;
  name: string;
  tz: string;
  author: unknown;
  maintainer: unknown;
  gallery: Array<{ id: string; source?: { type: string; id: string }; by?: unknown }>;
  work_stats: {
    experience_score: number | null;
    composite_score: number | null;
    n_users: number;
    n_checkins: number;
    policies: { max_stay: Record<string, number> };
  };
}

interface FeedItemDTO {
  id: string;
  scores: Record<string, number>;
  max_stay: string | null;
  note: string | null;
  photos: Array<Record<string, unknown>>;
  likes_count: number;
  liked_by_viewer: boolean;
  visited_at: string;
  author: unknown;
}

interface FeedPageDTO {
  checkins: FeedItemDTO[];
  nextCursor: string | null;
}

interface LastCheckinDTO {
  checkin: {
    id: string;
    scores: Record<string, number>;
    max_stay: string | null;
    note: string | null;
    visited_at: string;
  } | null;
  revisitWindowHours: number;
}

interface LikeDTO {
  liked: boolean;
  likesCount: number;
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
 * Bootstrap one cafe through HTTP only: photo upload + fused
 * POST /api/cafes. Returns the cafe and its creation check-in ids.
 */
async function createCafeViaHttp(
  client: ApiClient,
  input: {
    name: string;
    lat: number;
    lng: number;
    scores: Record<string, number>;
    max_stay: string;
    note: string;
    /** Optional backdated creation visit (public visited_at contract). */
    visited_at?: string;
  },
): Promise<{ cafeId: string; checkinId: string }> {
  const photoId = await uploadTestWebP(client);
  const res = await client.post<{ cafeId: string; checkinId: string; tz: string }>(
    cafesPOST,
    "/api/cafes",
    {
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      address: "1 Test Rd, Singapore",
      city: "singapore",
      checkin: {
        scores: input.scores,
        max_stay: input.max_stay,
        note: input.note,
        photo_ids: [photoId],
        ...(input.visited_at ? { visited_at: input.visited_at } : {}),
      },
    },
  );
  expect(res.status).toBe(201);
  expect(res.data.cafeId).toBeDefined();
  expect(res.data.checkinId).toBeDefined();
  return { cafeId: res.data.cafeId, checkinId: res.data.checkinId };
}

/** Toggle the caller's like on a check-in through the real route. */
async function likeCheckin(client: ApiClient, checkinId: string) {
  return client.post<LikeDTO, RouteContext<{ id: string }>>(
    likePOST,
    `/api/checkins/${checkinId}/like`,
    undefined,
    {},
    routeParams({ id: checkinId }),
  );
}

async function getCafeDetail(cafeId: string): Promise<CafeDetailDTO> {
  const res = await clientD.get<CafeDetailDTO, RouteContext<{ id: string }>>(
    cafeDetailGET,
    `/api/cafes/${cafeId}`,
    {},
    routeParams({ id: cafeId }),
  );
  expect(res.status).toBe(200);
  return res.data;
}

async function getFeed(
  client: ApiClient,
  cafeId: string,
  query?: Record<string, string>,
): Promise<{ status: number; data: FeedPageDTO }> {
  const res = await client.get<FeedPageDTO, RouteContext<{ id: string }>>(
    feedGET,
    `/api/cafes/${cafeId}/checkins`,
    query ? { query } : {},
    routeParams({ id: cafeId }),
  );
  return { status: res.status, data: res.data };
}

// Shared journey state across the ordered Path 4 → 5 flow.
let cafe1Id = "";
let creation1Id = "";
let bCheckin1Id = "";
let cCheckin1Id = "";
let cafe2Id = "";
let cafe3Id = "";
let creation3Id = "";

describeHttp("Paths 4+5: check-ins, revisit, idempotency & social likes HTTP suite", () => {
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

    // Harness setup: provision deterministic profiles for A–D plus the
    // slice-local fifth persona E (harness-owned seam, no test SQL).
    await seedHttpTestUsers(dbClient, users, [userE]);
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
      throw new AggregateError(errors, "http-checkins-social integration cleanup failed");
    }
  }, 60_000);

  // =========================================================================
  // 1. POST /api/checkins contract: auth, origin, validation, unknown cafe
  // =========================================================================

  it("Path 4: POST /api/checkins enforces auth, same-origin, payload validation, and 404s unknown cafes", async () => {
    // Anonymous write → 401 unauthorized
    const anon = await guestClient.post(checkinsPOST, "/api/checkins", {
      cafe_id: randomUUID(),
      scores: { overall: 70 },
      note: "ghost visit",
    });
    expect(anon.status).toBe(401);
    expect(anon.data).toMatchObject({ error: "unauthorized" });

    // Cross-site Origin → 403 forbidden_origin (one proof per spec §11)
    const evil = await clientA.post(
      checkinsPOST,
      "/api/checkins",
      { cafe_id: randomUUID(), scores: { overall: 70 }, note: "evil" },
      { headers: { origin: "https://evil.example" } },
    );
    expect(evil.status).toBe(403);
    expect(evil.data).toMatchObject({ error: "forbidden_origin" });

    // Payload validation matrix → 400 invalid_request (all fail before any write)
    const invalidCases: Array<{ name: string; body: unknown }> = [
      { name: "missing scores", body: { cafe_id: randomUUID(), note: "no scores" } },
      { name: "empty scores", body: { cafe_id: randomUUID(), scores: {}, note: "empty" } },
      {
        name: "score above 100",
        body: { cafe_id: randomUUID(), scores: { overall: 101 }, note: "hot" },
      },
      {
        name: "score below 0",
        body: { cafe_id: randomUUID(), scores: { wifi: -5 }, note: "cold" },
      },
      {
        name: "note over 500 chars",
        body: { cafe_id: randomUUID(), scores: { overall: 70 }, note: "x".repeat(501) },
      },
      {
        name: "future visited_at",
        body: {
          cafe_id: randomUUID(),
          scores: { overall: 70 },
          note: "time traveler",
          visited_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
      {
        name: "non-UUID cafe_id",
        body: { cafe_id: "not-a-uuid", scores: { overall: 70 }, note: "bad id" },
      },
      {
        name: "non-UUID idempotency_key (DG61)",
        body: {
          cafe_id: randomUUID(),
          scores: { overall: 70 },
          note: "bad key",
          idempotency_key: "not-a-uuid",
        },
      },
    ];
    for (const testCase of invalidCases) {
      const res = await clientA.post(checkinsPOST, "/api/checkins", testCase.body);
      expect(res.status, `Expected 400 for ${testCase.name}`).toBe(400);
      expect(res.data, `Expected invalid_request for ${testCase.name}`).toMatchObject({
        error: "invalid_request",
      });
    }

    // Unknown cafe → 404 (never a silent create)
    const ghost = await clientA.post(checkinsPOST, "/api/checkins", {
      cafe_id: randomUUID(),
      scores: { overall: 70 },
      note: "ghost visit",
    });
    expect(ghost.status).toBe(404);
    expect(ghost.data).toMatchObject({ error: "not_found" });
  });

  // =========================================================================
  // 2. Multi-user check-ins: one weighted vote per (user, cafe)
  // =========================================================================

  it("Path 4: multi-user check-ins each contribute one weighted vote (experience 75, composite 71.75)", async () => {
    // Spec §10 input matrix: A creates with full dims, B all-60s, C all-75s.
    const created = await createCafeViaHttp(clientA, {
      name: "Dynamics House",
      lat: 1.3065,
      lng: 103.8325,
      scores: { overall: 90, wifi: 90, outlets: 80, seats: 70, temp: 60, coffee: 95 },
      max_stay: "unlimited",
      note: "creator first impression",
    });
    cafe1Id = created.cafeId;
    creation1Id = created.checkinId;

    const second = await clientB.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe1Id,
      scores: { overall: 60, wifi: 60, outlets: 60, seats: 60, temp: 60, coffee: 60 },
      max_stay: "3h",
      note: "visitor perspective",
    });
    expect(second.status).toBe(201);
    expect(second.data.checkinId).toBeDefined();
    expect(second.data.checkinId).not.toBe(creation1Id);
    bCheckin1Id = second.data.checkinId;

    const third = await clientC.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe1Id,
      scores: { overall: 75, wifi: 75, outlets: 75, seats: 75, temp: 75, coffee: 75 },
      max_stay: "2h",
      note: "community visitor",
    });
    expect(third.status).toBe(201);
    cCheckin1Id = third.data.checkinId;

    // Reconciliation through User D's read: mean of the three per-user votes.
    // experience (90+60+75)/3 = 75; composite .3*75+.2*71.67+.2*68.33+.15*65+.15*76.67 = 71.75
    const detail = await getCafeDetail(cafe1Id);
    expect(detail.work_stats.experience_score).toBe(75);
    expect(detail.work_stats.composite_score).toBeCloseTo(71.75, 2);
    expect(detail.work_stats.n_users).toBe(3);
    expect(detail.work_stats.n_checkins).toBe(3);
    expect(detail.work_stats.policies.max_stay).toEqual({ unlimited: 1, "3h": 1, "2h": 1 });

    // DG13 through the public feed: item photos never carry `by`.
    const feed = await getFeed(clientD, cafe1Id);
    expect(feed.status).toBe(200);
    expect(feed.data.checkins).toHaveLength(3);
    for (const item of feed.data.checkins) {
      for (const photo of item.photos) {
        expect(photo).not.toHaveProperty("by");
      }
    }
  });

  // =========================================================================
  // 3. DG64 24h revisit → edit flow via checkins/last + PATCH
  // =========================================================================

  it("Path 4 (DG64): 24h revisit returns 409 + existing_checkin_id, then last → PATCH edit recomputes the aggregate", async () => {
    // B's second POST inside the 24h window → 409 with the live row id.
    const revisit = await clientB.post(checkinsPOST, "/api/checkins", {
      cafe_id: cafe1Id,
      scores: { overall: 65 },
      note: "second take",
    });
    expect(revisit.status).toBe(409);
    expect(revisit.data).toMatchObject({ error: "duplicate_checkin", existing_checkin_id: bCheckin1Id });

    const lastRes = await clientB.get<LastCheckinDTO, undefined, NextRequest>(
      checkinsLastGET,
      "/api/checkins/last",
      {
        query: { cafe_id: cafe1Id },
      },
    );
    expect(lastRes.status).toBe(200);
    expect(lastRes.data.revisitWindowHours).toBe(24);
    expect(lastRes.data.checkin?.id).toBe(bCheckin1Id);
    expect(lastRes.data.checkin?.scores.overall).toBe(60);

    // last seam guards: anonymous 401, malformed cafe_id 400.
    const anonLast = await guestClient.get<LastCheckinDTO, undefined, NextRequest>(
      checkinsLastGET,
      "/api/checkins/last",
      {
        query: { cafe_id: cafe1Id },
      },
    );
    expect(anonLast.status).toBe(401);
    expect(anonLast.data).toMatchObject({ error: "unauthorized" });
    const badLast = await clientB.get<LastCheckinDTO, undefined, NextRequest>(
      checkinsLastGET,
      "/api/checkins/last",
      {
        query: { cafe_id: "nope" },
      },
    );
    expect(badLast.status).toBe(400);
    expect(badLast.data).toMatchObject({ error: "invalid_request" });

    // B edits overall 60 → 70 with a replaced note and a cleared max_stay.
    // PATCH replaces the whole scores object (no server-side merge), so the
    // real client submits the full slider set — other dims stay at 60 and
    // the composite holds while experience moves.
    const editRes = await clientB.patch<{ cafeId: string }, RouteContext<{ id: string }>>(
      checkinPATCH,
      `/api/checkins/${bCheckin1Id}`,
      {
        scores: { overall: 70, wifi: 60, outlets: 60, seats: 60, temp: 60, coffee: 60 },
        note: "revisited and revised",
        max_stay: null,
      },
      {},
      routeParams({ id: bCheckin1Id }),
    );
    expect(editRes.status).toBe(200);
    expect(editRes.data).toMatchObject({ cafeId: cafe1Id });

    // Exactly one live row remains for B and the aggregate moves
    // experience (90+70+75)/3 = 78.33 while composite holds 71.75 (all dims resubmitted).
    const detail = await getCafeDetail(cafe1Id);
    expect(detail.work_stats.experience_score).toBeCloseTo(78.33, 2);
    expect(detail.work_stats.composite_score).toBeCloseTo(71.75, 2);
    expect(detail.work_stats.n_users).toBe(3);
    expect(detail.work_stats.n_checkins).toBe(3);
    expect(detail.work_stats.policies.max_stay).toEqual({ unlimited: 1, "2h": 1 });

    // Non-author PATCH → 403 forbidden (edit is author-only).
    const forbidden = await clientC.patch(checkinPATCH, `/api/checkins/${bCheckin1Id}`, {
      note: "hijack attempt",
    }, {}, routeParams({ id: bCheckin1Id }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.data).toMatchObject({ error: "forbidden" });
  });

  // =========================================================================
  // 4. 24h window expiry: backdated first visit + 0.6 decay contribution
  // =========================================================================

  it("Path 4 (DG64 window expiry): a 25h-old first visit lets the second POST create a new row with a 0.6-decay contribution", async () => {
    // The creator's fused first check-in is itself backdated 25h through the
    // public visited_at contract — no DB seam.
    const created = await createCafeViaHttp(clientA, {
      name: "Decay House",
      lat: 1.3075,
      lng: 103.8335,
      scores: { overall: 60 },
      max_stay: "unlimited",
      note: "decay anchor",
      visited_at: new Date(Date.now() - 25 * 3_600_000).toISOString(),
    });
    cafe2Id = created.cafeId;

    // Outside the window: a NEW row (201), not a 409.
    const nextDay = await clientA.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe2Id,
      scores: { overall: 80 },
      note: "back today",
    });
    expect(nextDay.status).toBe(201);
    expect(nextDay.data.checkinId).not.toBe(created.checkinId);

    // The §7 worked example, asserted directly: the single user's vote is the
    // recency-weighted mean (80×1 + 60×0.6)/1.6 = 72.5, collapsing to one vote.
    const solo = await getCafeDetail(cafe2Id);
    expect(solo.work_stats.experience_score).toBeCloseTo(72.5, 2);
    expect(solo.work_stats.n_users).toBe(1);
    expect(solo.work_stats.n_checkins).toBe(2);

    // Composed proof: a second user's fresh overall-90 vote means
    // experience = (72.5 + 90)/2 = 81.25 across the two users.
    const second = await clientB.post(checkinsPOST, "/api/checkins", {
      cafe_id: cafe2Id,
      scores: { overall: 90 },
      note: "second user",
    });
    expect(second.status).toBe(201);
    const detail = await getCafeDetail(cafe2Id);
    expect(detail.work_stats.experience_score).toBeCloseTo(81.25, 2);
    expect(detail.work_stats.n_users).toBe(2);
    expect(detail.work_stats.n_checkins).toBe(3);
  });

  // =========================================================================
  // 5. DG61 idempotency: replay returns the same id, winning over DG64
  // =========================================================================

  it("Path 4 (DG61): a replayed idempotency key returns 200 with the same id and writes no duplicate", async () => {
    const feedBefore = await getFeed(clientD, cafe2Id);
    expect(feedBefore.status).toBe(200);
    const rowsBefore = feedBefore.data.checkins.length;

    const key = randomUUID();
    const first = await clientC.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe2Id,
      scores: { overall: 70 },
      note: "first attempt",
      idempotency_key: key,
    });
    expect(first.status).toBe(201);
    const originalId = first.data.checkinId;

    // Replay with a different payload inside the 24h window: 200 with the
    // ORIGINAL id — replay is checked before the revisit window, never a 409.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const replay = await clientC.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
        cafe_id: cafe2Id,
        scores: { overall: 10 },
        note: "retried with different payload",
        idempotency_key: key,
      });
      expect(replay.status).toBe(200);
      expect(replay.data.checkinId).toBe(originalId);
    }

    // Zero new rows: the feed grows by exactly the first attempt, and the
    // first payload wins (visible through the public feed item).
    const feedAfter = await getFeed(clientD, cafe2Id);
    expect(feedAfter.data.checkins.length).toBe(rowsBefore + 1);
    const replayed = feedAfter.data.checkins.find((c) => c.id === originalId);
    expect(replayed?.note).toBe("first attempt");
    expect(replayed?.scores.overall).toBe(70);
  });

  // =========================================================================
  // 6. Feed: newest/helpful orderings, keyset cursor hop, cross-mode 400
  // =========================================================================

  it("Path 4 (DG113): feed serves newest/helpful orderings, keyset cursor hops, and rejects cross-mode cursors", async () => {
    const created = await createCafeViaHttp(clientA, {
      name: "Feed Pagination House",
      lat: 1.3085,
      lng: 103.8345,
      scores: { overall: 85, wifi: 85, outlets: 80, seats: 75, temp: 70, coffee: 88 },
      max_stay: "unlimited",
      note: "feed anchor",
    });
    cafe3Id = created.cafeId;
    creation3Id = created.checkinId;

    // 20 further visits, each backdated >24h so DG64 never trips. User E takes
    // the third rotation slot (the creator's fresh creation check-in blocks A);
    // the cycle puts the oldest visit (i=19) on user B so A and C can like it.
    const authors: Record<number, ApiClient> = { 0: clientC, 1: clientB, 2: clientE };
    let oldestId = "";
    for (let i = 0; i < 20; i += 1) {
      const author = authors[i % 3]!;
      const res = await author.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
        cafe_id: cafe3Id,
        scores: { overall: 70 },
        note: `feed visit ${i}`,
        visited_at: new Date(Date.now() - (25 + i * 3) * 3_600_000).toISOString(),
      });
      expect(res.status, `feed visit ${i} creates`).toBe(201);
      if (i === 19) oldestId = res.data.checkinId;
    }
    expect(oldestId).not.toBe("");

    // Newest (default mode, DG113): live creation first, 20 + 1 across the page boundary.
    const page1 = await getFeed(clientD, cafe3Id);
    expect(page1.status).toBe(200);
    expect(page1.data.checkins).toHaveLength(20);
    expect(page1.data.checkins[0]?.id).toBe(creation3Id);
    expect(typeof page1.data.nextCursor).toBe("string");

    const page2 = await getFeed(clientD, cafe3Id, { cursor: page1.data.nextCursor! });
    expect(page2.status).toBe(200);
    expect(page2.data.checkins).toHaveLength(1);
    expect(page2.data.nextCursor).toBeNull();
    const page1Ids = new Set(page1.data.checkins.map((c) => c.id));
    expect(page2.data.checkins.every((c) => !page1Ids.has(c.id))).toBe(true);
    const all = [...page1.data.checkins, ...page2.data.checkins];
    for (let i = 1; i < all.length; i += 1) {
      expect(new Date(all[i]!.visited_at).getTime()).toBeLessThanOrEqual(
        new Date(all[i - 1]!.visited_at).getTime(),
      );
    }

    // Unknown mode → 400 listing valid modes; garbage cursor → 400 invalid_request.
    const badMode = await getFeed(clientD, cafe3Id, { mode: "weird" });
    expect(badMode.status).toBe(400);
    expect(badMode.data).toMatchObject({ error: "invalid_request" });
    const badCursor = await getFeed(clientD, cafe3Id, { cursor: "not-a-cursor" });
    expect(badCursor.status).toBe(400);
    expect(badCursor.data).toMatchObject({ error: "invalid_request" });

    // Unknown cafe → 404, never an empty feed.
    const ghostId = randomUUID();
    const ghostFeed = await getFeed(clientD, ghostId);
    expect(ghostFeed.status).toBe(404);
    expect(ghostFeed.data).toMatchObject({ error: "not_found" });

    // A cursor issued for newest is rejected under helpful — never a silent reset.
    const crossMode = await getFeed(clientD, cafe3Id, {
      mode: "helpful",
      cursor: page1.data.nextCursor!,
    });
    expect(crossMode.status).toBe(400);
    expect(crossMode.data).toMatchObject({ error: "invalid_request" });

    // Helpful: two likes lift B's oldest visit above every unliked row.
    const likeA = await likeCheckin(clientA, oldestId);
    expect(likeA.status).toBe(200);
    const likeC = await likeCheckin(clientC, oldestId);
    expect(likeC.data).toMatchObject({ liked: true, likesCount: 2 });

    const helpful = await getFeed(clientD, cafe3Id, { mode: "helpful" });
    expect(helpful.status).toBe(200);
    expect(helpful.data.checkins[0]?.id).toBe(oldestId);
    expect(helpful.data.checkins[0]?.likes_count).toBe(2);
    // Full ordering, not just rank-1: likes_count desc across the whole page.
    for (let i = 1; i < helpful.data.checkins.length; i += 1) {
      expect(helpful.data.checkins[i]!.likes_count).toBeLessThanOrEqual(
        helpful.data.checkins[i - 1]!.likes_count,
      );
    }
    expect(helpful.data.checkins.slice(1).every((c) => c.likes_count === 0)).toBe(true);

    // Viewer isolation + default anonymity through the public feed surface:
    // likers see liked_by_viewer; the author (B, on his own liked check-in),
    // D, and guests do not; authors stay null.
    const asLiker = await getFeed(clientA, cafe3Id, { mode: "helpful" });
    expect(asLiker.data.checkins[0]?.liked_by_viewer).toBe(true);
    expect(helpful.data.checkins[0]?.liked_by_viewer).toBe(false);
    const asAuthor = await getFeed(clientB, cafe3Id, { mode: "helpful" });
    expect(asAuthor.data.checkins.find((c) => c.id === oldestId)?.liked_by_viewer).toBe(false);
    const asGuest = await getFeed(guestClient, cafe3Id);
    expect(asGuest.status).toBe(200);
    expect(asGuest.data.checkins.every((c) => c.liked_by_viewer === false)).toBe(true);
    expect(asGuest.data.checkins.every((c) => c.author === null)).toBe(true);
  });

  // =========================================================================
  // 7. Path 5: likes toggle, self-like 403, anon 401, viewer isolation
  // =========================================================================

  it("Path 5: likes toggle symmetrically, self-likes 403, anonymous 401, viewers stay isolated", async () => {
    // A likes B's check-in → 1; again → symmetric unlike → 0.
    const liked = await likeCheckin(clientA, bCheckin1Id);
    expect(liked.status).toBe(200);
    expect(liked.data).toMatchObject({ liked: true, likesCount: 1 });

    const unliked = await likeCheckin(clientA, bCheckin1Id);
    expect(unliked.data).toMatchObject({ liked: false, likesCount: 0 });

    // A re-likes and C likes → 2, and helpful mode puts B's check-in first.
    await likeCheckin(clientA, bCheckin1Id);
    const second = await likeCheckin(clientC, bCheckin1Id);
    expect(second.data).toMatchObject({ liked: true, likesCount: 2 });
    const helpful = await getFeed(clientD, cafe1Id, { mode: "helpful" });
    expect(helpful.data.checkins[0]?.id).toBe(bCheckin1Id);
    expect(helpful.data.checkins[0]?.likes_count).toBe(2);

    // liked_by_viewer isolation across all four postures: likers see true;
    // the author on his own liked check-in, the authed observer, and guests
    // see false.
    const asLiker = await getFeed(clientA, cafe1Id, { mode: "helpful" });
    expect(asLiker.data.checkins.find((c) => c.id === bCheckin1Id)?.liked_by_viewer).toBe(true);
    expect(helpful.data.checkins.find((c) => c.id === bCheckin1Id)?.liked_by_viewer).toBe(false);
    const asAuthor = await getFeed(clientB, cafe1Id, { mode: "helpful" });
    expect(asAuthor.data.checkins.find((c) => c.id === bCheckin1Id)?.liked_by_viewer).toBe(false);

    // Self-like iron rule (spec 0004 decision 8): author liking their own
    // creation check-in is rejected at the route.
    const selfA = await likeCheckin(clientA, creation1Id);
    expect(selfA.status).toBe(403);
    expect(selfA.data).toMatchObject({ error: "self_like_forbidden" });
    const selfB = await likeCheckin(clientB, bCheckin1Id);
    expect(selfB.status).toBe(403);
    expect(selfB.data).toMatchObject({ error: "self_like_forbidden" });

    // Anonymous like → 401; unknown check-in → 404; malformed id → 400.
    const anonLike = await likeCheckin(guestClient, bCheckin1Id);
    expect(anonLike.status).toBe(401);
    expect(anonLike.data).toMatchObject({ error: "unauthorized" });
    const ghostLike = await likeCheckin(clientA, randomUUID());
    expect(ghostLike.status).toBe(404);
    expect(ghostLike.data).toMatchObject({ error: "not_found" });
    const malformed = await likeCheckin(clientA, "nope");
    expect(malformed.status).toBe(400);
    expect(malformed.data).toMatchObject({ error: "invalid_request" });

    // C's own check-in is untouched by the toggle traffic above.
    const cItem = (await getFeed(clientD, cafe1Id)).data.checkins.find((c) => c.id === cCheckin1Id);
    expect(cItem?.likes_count).toBe(0);
  });
});
