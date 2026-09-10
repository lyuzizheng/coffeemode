/**
 * @vitest-environment node
 * Capstone: 4-user composed lifecycle suite (BRAWUKA-149).
 * Spec reference: docs/specs/0008-http-user-journey-matrix.md (§3 Acts 0–8,
 * §10 reconciliation ledger, §9 Path 6 deletion handoff).
 *
 * Runs against real Postgres/PostGIS and real MinIO when RUN_INTEGRATION=1.
 * Every state change and every assertion goes through the external HTTP API
 * (Next.js Route Handlers via the Stage 1 `http-client` harness); test code
 * never touches `lib/db/*`. The only database touchpoints are harness-owned
 * infrastructure: persona provisioning (`seedHttpTestUsers`) and rate-limit
 * bucket resets between Acts. This file owns the causal Acts 0–8 timeline
 * and the §10 ledger — per-slice boundary matrices stay owned by slices
 * 2A–2D and are only spot-checked here.
 */

import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as healthGET } from "@/app/api/health/route";
import { GET as cafesGET, POST as cafesPOST } from "@/app/api/cafes/route";
import { DELETE as cafeDELETE, GET as cafeDetailGET } from "@/app/api/cafes/[id]/route";
import { GET as feedGET } from "@/app/api/cafes/[id]/checkins/route";
import { POST as checkinsPOST } from "@/app/api/checkins/route";
import { GET as checkinsLastGET } from "@/app/api/checkins/last/route";
import { PATCH as checkinPATCH } from "@/app/api/checkins/[id]/route";
import { POST as likePOST } from "@/app/api/checkins/[id]/like/route";
import { POST as uploadPOST } from "@/app/api/images/upload/route";
import { GET as placesSearchGET } from "@/app/api/places/search/route";
import { GET as searchGET } from "@/app/api/search/route";
import { GET as profileGET, PATCH as profilePATCH } from "@/app/api/profile/route";
import { PATCH as identityPATCH } from "@/app/api/profile/identity/route";
import { GET as profileCheckinsGET } from "@/app/api/profile/checkins/route";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import type * as ImageServiceClient from "@/lib/images/image-service-client";
import {
  apiClient,
  createHttpTestUsers,
  parseRouteResponse,
  resetRateLimits,
  routeParams,
  seedHttpTestUsers,
  type ApiClient,
  type RouteContext,
} from "../helpers/http-client";
import {
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
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
const describeLifecycle = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_http_lifecycle");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const cleanupErrors: string[] = [];
const previousDatabaseUrl = process.env.DATABASE_URL;

const users = createHttpTestUsers();
const clientA = apiClient(users.userA);
const clientB = apiClient(users.userB);
const clientC = apiClient(users.userC);
const clientD = apiClient(users.userD);
const guestClient = apiClient().asGuest();

/** `NextRequest`-typed handlers take no route ctx. */
type NoCtx = undefined;
/** `{ params: Promise<{ id }> }` ctx for detail/feed/check-in/like/delete handlers. */
type IdCtx = RouteContext<{ id: string }>;

// ——— External HTTP contract shapes ———

interface WorkStatsDTO {
  experience_score: number | null;
  composite_score: number | null;
  n_users: number;
  n_checkins: number;
  policies: { max_stay: Record<string, number> };
}

interface CafeDetailDTO {
  id: string;
  name: string;
  tz: string | null;
  author: { handle: string; display_name: string; avatar_url: string | null } | null;
  maintainer: string | null;
  gallery: Array<{ id: string; source?: { type: string; id: string } }>;
  work_stats: WorkStatsDTO;
}

interface NearbyDTO {
  cafes: Array<{
    id: string;
    name: string;
    distance_m?: number;
    visibility?: string;
    maintainer?: string | null;
    work_stats: WorkStatsDTO;
  }>;
}

interface SearchDTO {
  results: Array<{
    id: string;
    type: string;
    name: string;
    cafe?: { id: string; name: string };
  }>;
  total_count: number;
  is_weak_results: boolean;
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

interface ProfileDTO {
  profile: {
    id: string;
    displayName: string;
    showPublicIdentity: boolean;
    publicHandle: string | null;
  };
  stats: { cafesCount: number; checkinsCount: number };
}

interface IdentityDTO {
  ok: boolean;
  showPublicIdentity: boolean;
  publicHandle: string | null;
}

// Spec §10 input-matrix coordinates. D observes from 1.3521, 103.8198.
const D_LAT = 1.3521;
const D_LNG = 103.8198;
const CAFE1_LAT = 1.3048;
const CAFE1_LNG = 103.8318;
const CAFE2_LAT = 35.658;
const CAFE2_LNG = 139.7016;
const CAFE3_LAT = 51.5133;
const CAFE3_LNG = -0.1364;

// Deterministic open_now trio (spec §4): always-open / explicitly-closed / unknown.
const ALWAYS_OPEN = {
  mon: { open: "00:00", close: "23:59" },
  tue: { open: "00:00", close: "23:59" },
  wed: { open: "00:00", close: "23:59" },
  thu: { open: "00:00", close: "23:59" },
  fri: { open: "00:00", close: "23:59" },
  sat: { open: "00:00", close: "23:59" },
  sun: { open: "00:00", close: "23:59" },
} as const;
const ALWAYS_CLOSED = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
} as const;

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
 * Bootstrap one cafe through HTTP only: photo upload + fused POST /api/cafes.
 * Returns the cafe, its creation check-in, and the derived tz.
 */
async function createCafeViaHttp(
  client: ApiClient,
  input: {
    name: string;
    lat: number;
    lng: number;
    address: string;
    city: string;
    google_place_id: string;
    price_range: number;
    opening_hours?: unknown;
    scores: Record<string, number>;
    max_stay: string;
    note: string;
  },
): Promise<{ cafeId: string; checkinId: string; tz: string }> {
  const photoId = await uploadTestWebP(client);
  const res = await client.post<{ cafeId: string; checkinId: string; tz: string }>(
    cafesPOST,
    "/api/cafes",
    {
      name: input.name,
      lat: input.lat,
      lng: input.lng,
      address: input.address,
      city: input.city,
      google_place_id: input.google_place_id,
      price_range: input.price_range,
      ...(input.opening_hours !== undefined ? { opening_hours: input.opening_hours } : {}),
      checkin: {
        scores: input.scores,
        max_stay: input.max_stay,
        note: input.note,
        photo_ids: [photoId],
      },
    },
  );
  expect(res.status).toBe(201);
  expect(res.data.cafeId).toBeDefined();
  expect(res.data.checkinId).toBeDefined();
  return { cafeId: res.data.cafeId, checkinId: res.data.checkinId, tz: res.data.tz };
}

/** Read one cafe detail through User D's (authed observer) GET. */
async function getCafeDetailAs(client: ApiClient, cafeId: string): Promise<CafeDetailDTO> {
  const res = await client.get<CafeDetailDTO, IdCtx, Request>(
    cafeDetailGET,
    `/api/cafes/${cafeId}`,
    {},
    routeParams({ id: cafeId }),
  );
  expect(res.status).toBe(200);
  return res.data;
}

/** Read one cafe feed page through the given client's GET. */
async function getFeed(
  client: ApiClient,
  cafeId: string,
  query?: Record<string, string>,
): Promise<{ status: number; data: FeedPageDTO }> {
  const res = await client.get<FeedPageDTO, IdCtx, Request>(
    feedGET,
    `/api/cafes/${cafeId}/checkins`,
    query ? { query } : {},
    routeParams({ id: cafeId }),
  );
  return { status: res.status, data: res.data };
}

/** Toggle the caller's like on a check-in through the real route. */
async function likeCheckin(client: ApiClient, checkinId: string) {
  return client.post<{ liked: boolean; likesCount: number }, IdCtx, Request>(
    likePOST,
    `/api/checkins/${checkinId}/like`,
    undefined,
    {},
    routeParams({ id: checkinId }),
  );
}

// Shared timeline state across the ordered Acts 0–8 flow.
let cafe1Id = "";
let cafe2Id = "";
let cafe3Id = "";
let creation1Id = "";
let bCheckin1Id = "";
let cCheckin1Id = "";

describeLifecycle("capstone: 4-user composed lifecycle Acts 0–8 (spec 0008 §3, §10, §9)", () => {
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

    // Harness provisioning: deterministic profile rows for A/B/C/D (no product SQL).
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
      const admin = new pg.Client(getPoolConfig(adminDbUrl));
      try {
        await admin.connect();
        await admin.query(`drop database if exists ${quotedIdentifier(TEST_DB)} with (force)`);
      } catch (err) {
        errors.push(err);
      } finally {
        try {
          await admin.end();
        } catch (err) {
          errors.push(err);
        }
      }
    }

    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("Act 0 (harness): liveness smoke, persona sessions resolve, POI seam injects the google shape with zero network", async () => {
    // Liveness smoke (spec §11): the sync GET takes no request — parse directly.
    const health = await parseRouteResponse<{ ok: boolean }>(healthGET());
    expect(health.status).toBe(200);
    expect(health.data.ok).toBe(true);

    for (const user of [users.userA, users.userB, users.userC, users.userD]) {
      const res = await apiClient(user).get<ProfileDTO, NoCtx, NextRequest>(
        profileGET,
        "/api/profile",
      );
      expect(res.status).toBe(200);
      expect(res.data.profile.id).toBe(user.id);
    }

    const poi = await clientA.get<{
      results: Array<{ place_id: string; source: string; types: string[]; business_status: string }>;
    }>(placesSearchGET, "/api/places/search", {
      query: { source: "google", q: "Lifecycle" },
    });
    expect(poi.status).toBe(200);
    expect(poi.data.results.length).toBeGreaterThan(0);
    const hit = poi.data.results[0]!;
    expect(hit.source).toBe("google");
    expect(hit.place_id).toMatch(/^ChIJ/);
    expect(hit.types).toContain("cafe");
    expect(hit.business_status).toBe("OPERATIONAL");
  });

  it("Act 1 (Path 2): A/B/C create Cafe 1 (Singapore) / 2 (Tokyo) / 3 (London) with fused check-ins, tz derivation, and default anonymity", async () => {
    // §11 spot-checks (full matrices stay slice-owned): anonymous 401, cross-site 403.
    const anon = await guestClient.post(cafesPOST, "/api/cafes", {
      name: "Ghost Cafe",
      lat: CAFE1_LAT,
      lng: CAFE1_LNG,
      checkin: { scores: { overall: 80 }, max_stay: "unlimited", note: "ghost", photo_ids: [randomUUID()] },
    });
    expect(anon.status).toBe(401);
    expect(anon.data).toMatchObject({ error: "unauthorized" });

    const evil = await clientA.post(
      cafesPOST,
      "/api/cafes",
      {
        name: "Evil Cafe",
        lat: CAFE1_LAT,
        lng: CAFE1_LNG,
        checkin: { scores: { overall: 80 }, max_stay: "unlimited", note: "evil", photo_ids: [randomUUID()] },
      },
      { headers: { origin: "https://evil.example" } },
    );
    expect(evil.status).toBe(403);
    expect(evil.data).toMatchObject({ error: "forbidden_origin" });

    // §10 input matrix row 1: A → Cafe 1, full dims, unlimited.
    const cafe1 = await createCafeViaHttp(clientA, {
      name: "Orchard Pioneer Roasters",
      lat: CAFE1_LAT,
      lng: CAFE1_LNG,
      address: "1 Orchard Rd, Singapore",
      city: "singapore",
      google_place_id: "ChIJLIFECYCLECAFE01",
      price_range: 2,
      opening_hours: ALWAYS_OPEN,
      scores: { overall: 90, wifi: 90, outlets: 80, seats: 70, temp: 60, coffee: 95 },
      max_stay: "unlimited",
      note: "Flagship pioneering work cafe in Orchard",
    });
    expect(cafe1.tz).toBe("Asia/Singapore");
    cafe1Id = cafe1.cafeId;
    creation1Id = cafe1.checkinId;

    // §10 row 4: B → Cafe 2 (creation), overall-only 85, 3h, explicitly closed days.
    const cafe2 = await createCafeViaHttp(clientB, {
      name: "Shibuya Work Lab",
      lat: CAFE2_LAT,
      lng: CAFE2_LNG,
      address: "1 Shibuya, Tokyo",
      city: "tokyo",
      google_place_id: "ChIJLIFECYCLECAFE02",
      price_range: 2,
      opening_hours: ALWAYS_CLOSED,
      scores: { overall: 85 },
      max_stay: "3h",
      note: "Quiet spot in Shibuya",
    });
    expect(cafe2.tz).toBe("Asia/Tokyo");
    cafe2Id = cafe2.cafeId;

    // §10 row 7: C → Cafe 3 (creation, solo), overall 40, unknown stay, no hours.
    const cafe3 = await createCafeViaHttp(clientC, {
      name: "Soho Work Studio",
      lat: CAFE3_LAT,
      lng: CAFE3_LNG,
      address: "1 Soho, London",
      city: "london",
      google_place_id: "ChIJLIFECYCLECAFE03",
      price_range: 2,
      scores: { overall: 40 },
      max_stay: "unknown",
      note: "Central London study cafe",
    });
    expect(cafe3.tz).toBe("Europe/London");
    cafe3Id = cafe3.cafeId;

    // Initial aggregate is exactly the creator's single contribution (User D reads).
    // composite: 90*.3 + 80*.2 + 70*.2 + 60*.15 + 95*.15 = 80.25.
    const detail = await getCafeDetailAs(clientD, cafe1Id);
    expect(detail.work_stats.experience_score).toBe(90);
    expect(detail.work_stats.composite_score).toBeCloseTo(80.25, 2);
    expect(detail.work_stats.n_users).toBe(1);
    expect(detail.work_stats.n_checkins).toBe(1);
    expect(detail.work_stats.policies.max_stay).toEqual({ unlimited: 1 });

    // Default anonymity (DG13): author null, maintainer null while creator-owned.
    expect(detail.author).toBeNull();
    expect(detail.maintainer).toBeNull();
    expect(detail.gallery).toHaveLength(1);
    expect(detail.gallery[0]?.source).toEqual({ type: "checkin", id: creation1Id });
  });

  it("Act 2 (Path 1, DG46/DG128): User D anonymous discovery truth table — distance order, city switch, open_now trio, min-score, weak-results fallback", async () => {
    // Geo-nearby: Cafe 1 present closest-first; Tokyo/London excluded by distance.
    const nearby = await guestClient.get<NearbyDTO>(cafesGET, "/api/cafes", {
      query: { lat: D_LAT, lng: D_LNG, radius_km: 10 },
    });
    expect(nearby.status).toBe(200);
    const nearbyIds = nearby.data.cafes.map((c) => c.id);
    expect(nearbyIds).toContain(cafe1Id);
    expect(nearbyIds).not.toContain(cafe2Id);
    expect(nearbyIds).not.toContain(cafe3Id);
    expect(nearby.data.cafes[0]?.id).toBe(cafe1Id);
    expect(typeof nearby.data.cafes[0]?.distance_m).toBe("number");
    // Response hygiene: public visibility, never leaks created_by.
    expect(nearby.data.cafes[0]).toMatchObject({ visibility: "public" });
    expect(nearby.data.cafes[0]).not.toHaveProperty("created_by");

    // Missing coords → 400 invalid_request (never a silent re-anchor).
    const badCoords = await guestClient.get(cafesGET, "/api/cafes", {
      query: { lng: D_LNG },
    });
    expect(badCoords.status).toBe(400);
    expect(badCoords.data).toMatchObject({ error: "invalid_request" });

    // Empty area → honest 200 empty state, never an error.
    const emptyArea = await guestClient.get<NearbyDTO>(cafesGET, "/api/cafes", {
      query: { lat: 0, lng: -140 },
    });
    expect(emptyArea.status).toBe(200);
    expect(emptyArea.data.cafes).toEqual([]);

    // City switch scopes results: tokyo → Cafe 2, london → Cafe 3.
    const tokyo = await guestClient.get<SearchDTO>(searchGET, "/api/search", {
      query: { city: "tokyo" },
    });
    expect(tokyo.status).toBe(200);
    expect(tokyo.data.results.some((r) => r.cafe?.id === cafe2Id)).toBe(true);

    const london = await guestClient.get<SearchDTO>(searchGET, "/api/search", {
      query: { city: "london" },
    });
    expect(london.status).toBe(200);
    expect(london.data.results.some((r) => r.cafe?.id === cafe3Id)).toBe(true);

    // Explicit unknown city → 400 invalid_request, never a silent re-anchor (DG128).
    const unknownCity = await guestClient.get(searchGET, "/api/search", {
      query: { city: "atlantis" },
    });
    expect(unknownCity.status).toBe(400);
    expect(unknownCity.data).toMatchObject({ error: "invalid_request" });

    // Deterministic open_now trio: always-open in, closed/unknown out.
    const sgOpen = await guestClient.get<SearchDTO>(searchGET, "/api/search", {
      query: { open_now: true },
    });
    expect(sgOpen.status).toBe(200);
    expect(sgOpen.data.results.some((r) => r.cafe?.id === cafe1Id)).toBe(true);

    const tokyoOpen = await guestClient.get<SearchDTO>(searchGET, "/api/search", {
      query: { city: "tokyo", open_now: true },
    });
    expect(tokyoOpen.status).toBe(200);
    expect(tokyoOpen.data.results.some((r) => r.cafe?.id === cafe2Id)).toBe(false);

    const londonOpen = await guestClient.get<SearchDTO>(searchGET, "/api/search", {
      query: { city: "london", open_now: true },
    });
    expect(londonOpen.status).toBe(200);
    expect(londonOpen.data.results.some((r) => r.cafe?.id === cafe3Id)).toBe(false);

    // Min-score: Cafe 3 (experience 40) is excluded by filter_overall=60, and
    // the impossible combination answers with the weak-results empty state.
    const londonFiltered = await guestClient.get<SearchDTO>(searchGET, "/api/search", {
      query: { city: "london", filter_overall: 60 },
    });
    expect(londonFiltered.status).toBe(200);
    expect(londonFiltered.data.results).toEqual([]);
    expect(londonFiltered.data.total_count).toBe(0);
    expect(londonFiltered.data.is_weak_results).toBe(true);

    // Response hygiene: cache + search-mode headers present.
    expect(tokyo.headers.get("cache-control")).toContain("private");
    expect(tokyo.headers.get("x-search-mode")).toBeTruthy();
  });

  it("Act 3 (Path 4, DG61): cross check-ins recompute aggregates; the DG61 replay pair writes exactly one row (Cafe 2 n_checkins 3)", async () => {
    // §10 rows 2–3: B → 1 (all 60s, 3h), C → 1 (all 75s, 2h).
    const bVisit = await clientB.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe1Id,
      scores: { overall: 60, wifi: 60, outlets: 60, seats: 60, temp: 60, coffee: 60 },
      max_stay: "3h",
      note: "visitor perspective",
    });
    expect(bVisit.status).toBe(201);
    bCheckin1Id = bVisit.data.checkinId;

    const cVisit = await clientC.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe1Id,
      scores: { overall: 75, wifi: 75, outlets: 75, seats: 75, temp: 75, coffee: 75 },
      max_stay: "2h",
      note: "community visitor",
    });
    expect(cVisit.status).toBe(201);
    cCheckin1Id = cVisit.data.checkinId;

    // §10 rows 5–6: A → 2 (88, 3h), C → 2 (92, 2h) with the same key twice.
    const aVisit2 = await clientA.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe2Id,
      scores: { overall: 88 },
      max_stay: "3h",
      note: "pioneer visits Tokyo",
    });
    expect(aVisit2.status).toBe(201);

    const idempotencyKey = randomUUID();
    const first = await clientC.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe2Id,
      scores: { overall: 92 },
      max_stay: "2h",
      note: "community visitor in Tokyo",
      idempotency_key: idempotencyKey,
    });
    expect(first.status).toBe(201);

    const replay = await clientC.post<{ checkinId: string }>(checkinsPOST, "/api/checkins", {
      cafe_id: cafe2Id,
      scores: { overall: 10 },
      max_stay: "2h",
      note: "retried with different payload",
      idempotency_key: idempotencyKey,
    });
    expect(replay.status).toBe(200);
    expect(replay.data.checkinId).toBe(first.data.checkinId);

    // §10 checkpoint after Act 3 (User D reads).
    const cafe1 = await getCafeDetailAs(clientD, cafe1Id);
    expect(cafe1.work_stats.experience_score).toBe(75);
    expect(cafe1.work_stats.composite_score).toBeCloseTo(71.75, 2);
    expect(cafe1.work_stats.n_users).toBe(3);
    expect(cafe1.work_stats.n_checkins).toBe(3);
    expect(cafe1.work_stats.policies.max_stay).toEqual({ unlimited: 1, "3h": 1, "2h": 1 });

    // (85 + 88 + 92) / 3 = 88.33; the DG61 pair counts as one row.
    const cafe2 = await getCafeDetailAs(clientD, cafe2Id);
    expect(cafe2.work_stats.experience_score).toBeCloseTo(88.33, 2);
    expect(cafe2.work_stats.n_users).toBe(3);
    expect(cafe2.work_stats.n_checkins).toBe(3);
    expect(cafe2.work_stats.policies.max_stay).toEqual({ "3h": 2, "2h": 1 });

    const cafe3 = await getCafeDetailAs(clientD, cafe3Id);
    expect(cafe3.work_stats.experience_score).toBe(40);
    expect(cafe3.work_stats.n_users).toBe(1);
    expect(cafe3.work_stats.n_checkins).toBe(1);
  });

  it("Act 4 (Path 4, DG64): B's 24h revisit 409s, then last → PATCH edit moves experience 75 → 78.33 with composite untouched", async () => {
    const revisit = await clientB.post(checkinsPOST, "/api/checkins", {
      cafe_id: cafe1Id,
      scores: { overall: 65 },
      note: "second take",
    });
    expect(revisit.status).toBe(409);
    expect(revisit.data).toMatchObject({ error: "duplicate_checkin", existing_checkin_id: bCheckin1Id });

    const lastRes = await clientB.get<
      { checkin: { id: string; scores: Record<string, number> } | null; revisitWindowHours: number },
      NoCtx,
      NextRequest
    >(checkinsLastGET, "/api/checkins/last", {
      query: { cafe_id: cafe1Id },
    });
    expect(lastRes.status).toBe(200);
    expect(lastRes.data.revisitWindowHours).toBe(24);
    expect(lastRes.data.checkin?.id).toBe(bCheckin1Id);
    expect(lastRes.data.checkin?.scores.overall).toBe(60);

    // PATCH replaces the whole scores object: all dims resubmitted at 60 so
    // only overall moves and the composite holds.
    const editRes = await clientB.patch<{ cafeId: string }, IdCtx, Request>(
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

    // (90 + 70 + 75) / 3 = 78.33; composite holds 71.75; B's cleared max_stay drops out.
    const cafe1 = await getCafeDetailAs(clientD, cafe1Id);
    expect(cafe1.work_stats.experience_score).toBeCloseTo(78.33, 2);
    expect(cafe1.work_stats.composite_score).toBeCloseTo(71.75, 2);
    expect(cafe1.work_stats.n_users).toBe(3);
    expect(cafe1.work_stats.n_checkins).toBe(3);
    expect(cafe1.work_stats.policies.max_stay).toEqual({ unlimited: 1, "2h": 1 });
  });

  it("Act 5 (Path 3, spec 0006): A renames, opts identity on then off — public projection flips and restores losslessly, released handle stays reserved", async () => {
    const renamed = await clientA.patch<{ profile: { displayName: string } }, NoCtx, NextRequest>(
      profilePATCH,
      "/api/profile",
      { displayName: "  Pioneer Ann  " },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.data.profile.displayName).toBe("Pioneer Ann");

    const readAuthorAs = async (client: ApiClient) => {
      const detail = await getCafeDetailAs(client, cafe1Id);
      const feed = await getFeed(client, cafe1Id);
      expect(feed.status).toBe(200);
      return {
        detail: detail.author,
        feed: feed.data.checkins.find((c) => c.id === creation1Id)?.author ?? null,
      };
    };

    expect((await readAuthorAs(clientD)).detail).toBeNull();

    const optIn = await clientA.patch<IdentityDTO, NoCtx, NextRequest>(
      identityPATCH,
      "/api/profile/identity",
      { showPublicIdentity: true, publicHandle: "pioneer-a" },
    );
    expect(optIn.status).toBe(200);
    expect(optIn.data).toMatchObject({
      ok: true,
      showPublicIdentity: true,
      publicHandle: "pioneer-a",
    });

    const projected = await readAuthorAs(clientD);
    expect(projected.detail).toEqual({
      handle: "pioneer-a",
      display_name: "Pioneer Ann",
      avatar_url: null,
    });
    expect(projected.feed).toEqual({
      handle: "pioneer-a",
      display_name: "Pioneer Ann",
      avatar_url: null,
    });

    const optOut = await clientA.patch<IdentityDTO, NoCtx, NextRequest>(
      identityPATCH,
      "/api/profile/identity",
      { showPublicIdentity: false },
    );
    expect(optOut.status).toBe(200);
    expect(optOut.data.showPublicIdentity).toBe(false);

    // Read-time projection restores null everywhere with rows intact.
    const hidden = await readAuthorAs(clientD);
    expect(hidden.detail).toBeNull();
    expect(hidden.feed).toBeNull();

    // Released handle stays reserved: C adopting pioneer-a → 409 handle_taken.
    const stolen = await clientC.patch(identityPATCH, "/api/profile/identity", {
      showPublicIdentity: true,
      publicHandle: "pioneer-a",
    });
    expect(stolen.status).toBe(409);
    expect(stolen.data).toMatchObject({ error: "handle_taken" });
  });

  it("Act 6 (ledger, DG13): User D reconciles the full §10 ledger anonymously and authenticated — aggregates, order, feed, viewer flags, projections, stats", async () => {
    for (const observer of [guestClient, clientD]) {
      const cafe1 = await getCafeDetailAs(observer, cafe1Id);
      expect(cafe1.work_stats.experience_score).toBeCloseTo(78.33, 2);
      expect(cafe1.work_stats.composite_score).toBeCloseTo(71.75, 2);
      expect(cafe1.work_stats.n_users).toBe(3);
      expect(cafe1.work_stats.n_checkins).toBe(3);
      // A opted back out in Act 5: anonymous surface again.
      expect(cafe1.author).toBeNull();
      expect(cafe1.maintainer).toBeNull();

      const cafe2 = await getCafeDetailAs(observer, cafe2Id);
      expect(cafe2.work_stats.experience_score).toBeCloseTo(88.33, 2);
      expect(cafe2.work_stats.n_users).toBe(3);
      expect(cafe2.work_stats.n_checkins).toBe(3);

      const cafe3 = await getCafeDetailAs(observer, cafe3Id);
      expect(cafe3.work_stats.experience_score).toBe(40);
      expect(cafe3.work_stats.n_users).toBe(1);
      expect(cafe3.work_stats.n_checkins).toBe(1);

      // Distance order holds from D's doorstep in both postures.
      const nearby = await observer.get<NearbyDTO>(cafesGET, "/api/cafes", {
        query: { lat: D_LAT, lng: D_LNG, radius_km: 10 },
      });
      expect(nearby.status).toBe(200);
      expect(nearby.data.cafes[0]?.id).toBe(cafe1Id);

      // Feed newest-first (DG113): C's visit, then B's, then A's creation.
      const feed = await getFeed(observer, cafe1Id);
      expect(feed.status).toBe(200);
      expect(feed.data.checkins).toHaveLength(3);
      expect(feed.data.checkins.map((c) => c.id)).toEqual([cCheckin1Id, bCheckin1Id, creation1Id]);
      for (const item of feed.data.checkins) {
        expect(item.liked_by_viewer).toBe(false);
        expect(item.author).toBeNull();
        for (const photo of item.photos) {
          expect(photo).not.toHaveProperty("by");
        }
      }
    }

    // Profile stats move with lifecycle events (distinct live cafes visited / live check-ins).
    const statsA = await clientA.get<ProfileDTO, NoCtx, NextRequest>(profileGET, "/api/profile");
    expect(statsA.data.stats).toEqual({ cafesCount: 2, checkinsCount: 2 });
    const statsB = await clientB.get<ProfileDTO, NoCtx, NextRequest>(profileGET, "/api/profile");
    expect(statsB.data.stats).toEqual({ cafesCount: 2, checkinsCount: 2 });
    const statsC = await clientC.get<ProfileDTO, NoCtx, NextRequest>(profileGET, "/api/profile");
    expect(statsC.data.stats).toEqual({ cafesCount: 3, checkinsCount: 3 });
    const statsD = await clientD.get<ProfileDTO, NoCtx, NextRequest>(profileGET, "/api/profile");
    expect(statsD.data.stats).toEqual({ cafesCount: 0, checkinsCount: 0 });
  });

  it("Act 7 (Path 5, spec 0004 decision 8): A/C like B's Cafe 1 check-in to likes_count 2 with helpful-first; self-like 403, anonymous 401", async () => {
    const liked = await likeCheckin(clientA, bCheckin1Id);
    expect(liked.status).toBe(200);
    expect(liked.data).toMatchObject({ liked: true, likesCount: 1 });

    const unliked = await likeCheckin(clientA, bCheckin1Id);
    expect(unliked.data).toMatchObject({ liked: false, likesCount: 0 });

    await likeCheckin(clientA, bCheckin1Id);
    const second = await likeCheckin(clientC, bCheckin1Id);
    expect(second.data).toMatchObject({ liked: true, likesCount: 2 });

    const helpful = await getFeed(clientD, cafe1Id, { mode: "helpful" });
    expect(helpful.status).toBe(200);
    expect(helpful.data.checkins[0]?.id).toBe(bCheckin1Id);
    expect(helpful.data.checkins[0]?.likes_count).toBe(2);

    // liked_by_viewer isolation: likers see true; the author, the authed
    // observer, and guests see false.
    const asLiker = await getFeed(clientA, cafe1Id, { mode: "helpful" });
    expect(asLiker.data.checkins.find((c) => c.id === bCheckin1Id)?.liked_by_viewer).toBe(true);
    expect(helpful.data.checkins.find((c) => c.id === bCheckin1Id)?.liked_by_viewer).toBe(false);
    const asAuthor = await getFeed(clientB, cafe1Id, { mode: "helpful" });
    expect(asAuthor.data.checkins.find((c) => c.id === bCheckin1Id)?.liked_by_viewer).toBe(false);
    const asGuest = await getFeed(guestClient, cafe1Id);
    expect(asGuest.data.checkins.every((c) => c.liked_by_viewer === false)).toBe(true);

    // Self-like iron rule: authors liking their own rows are rejected at the route.
    const selfA = await likeCheckin(clientA, creation1Id);
    expect(selfA.status).toBe(403);
    expect(selfA.data).toMatchObject({ error: "self_like_forbidden" });
    const selfB = await likeCheckin(clientB, bCheckin1Id);
    expect(selfB.status).toBe(403);
    expect(selfB.data).toMatchObject({ error: "self_like_forbidden" });

    // Anonymous like → 401; unknown check-in → 404.
    const anonLike = await likeCheckin(guestClient, bCheckin1Id);
    expect(anonLike.status).toBe(401);
    expect(anonLike.data).toMatchObject({ error: "unauthorized" });
    const ghostLike = await likeCheckin(clientA, randomUUID());
    expect(ghostLike.status).toBe(404);
    expect(ghostLike.data).toMatchObject({ error: "not_found" });
  });

  it("Act 8 (Path 6, DG125/DG146): Cafe 3 shells, Cafe 1 hands off to the service account, User D re-reconciles the post-deletion ledger", async () => {
    // Authorization line: non-creator B deleting Cafe 3 → 403 forbidden.
    const forbidden = await clientB.delete(
      cafeDELETE,
      `/api/cafes/${cafe3Id}`,
      undefined,
      {},
      routeParams({ id: cafe3Id }),
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.data).toMatchObject({ error: "forbidden" });

    // Sole-owner shell: C deletes Cafe 3 — the row survives as an empty shell.
    const shell = await clientC.delete<
      { ok: boolean; id: string; removed_checkins: number; owner_transferred: boolean; shell: boolean },
      IdCtx,
      Request
    >(cafeDELETE, `/api/cafes/${cafe3Id}`, undefined, {}, routeParams({ id: cafe3Id }));
    expect(shell.status).toBe(200);
    expect(shell.data).toEqual({
      ok: true,
      id: cafe3Id,
      removed_checkins: 1,
      owner_transferred: false,
      shell: true,
    });

    const shellDetail = await getCafeDetailAs(clientD, cafe3Id);
    expect(shellDetail.work_stats.n_checkins).toBe(0);
    expect(shellDetail.work_stats.n_users).toBe(0);
    expect(shellDetail.gallery).toEqual([]);
    expect(shellDetail.maintainer).toBeNull();

    const shellFeed = await getFeed(clientD, cafe3Id);
    expect(shellFeed.status).toBe(200);
    expect(shellFeed.data.checkins).toEqual([]);

    // The shell remains listed as a public empty shell near London.
    const londonNearby = await guestClient.get<NearbyDTO>(cafesGET, "/api/cafes", {
      query: { lat: CAFE3_LAT, lng: CAFE3_LNG, radius_km: 10 },
    });
    expect(londonNearby.status).toBe(200);
    expect(londonNearby.data.cafes.map((c) => c.id)).toContain(cafe3Id);

    // C's check-in no longer lists anywhere under her profile.
    const cCheckins = await clientC.get<{ items: unknown[] }, NoCtx, NextRequest>(
      profileCheckinsGET,
      "/api/profile/checkins",
    );
    expect(cCheckins.status).toBe(200);
    expect(JSON.stringify(cCheckins.data.items)).not.toContain(cafe3Id);

    // Community cafe: A's bare DELETE → 403 cafe_has_other_checkins with n=2.
    const bare = await clientA.delete(cafeDELETE, `/api/cafes/${cafe1Id}`, undefined, {}, routeParams({
      id: cafe1Id,
    }));
    expect(bare.status).toBe(403);
    expect(bare.data).toMatchObject({ error: "cafe_has_other_checkins", n: 2 });

    // With confirm: handoff to the service account, A's row removed.
    const handoff = await clientA.delete<
      { ok: boolean; id: string; removed_checkins: number; owner_transferred: boolean; shell: boolean },
      IdCtx,
      Request
    >(cafeDELETE, `/api/cafes/${cafe1Id}`, { confirm: true }, {}, routeParams({ id: cafe1Id }));
    expect(handoff.status).toBe(200);
    expect(handoff.data).toEqual({
      ok: true,
      id: cafe1Id,
      removed_checkins: 1,
      owner_transferred: true,
      shell: false,
    });

    // A's repeat DELETE → 403: she is no longer the creator.
    const repeat = await clientA.delete(
      cafeDELETE,
      `/api/cafes/${cafe1Id}`,
      undefined,
      {},
      routeParams({ id: cafe1Id }),
    );
    expect(repeat.status).toBe(403);
    expect(repeat.data).toMatchObject({ error: "forbidden" });

    // Post-handoff detail: system maintainer brand, anonymous author, feed
    // retains only B's and C's check-ins, aggregates recomputed without A
    // (experience (70+75)/2 = 72.5; dims all (60+75)/2 → composite 67.5).
    const handed = await getCafeDetailAs(clientD, cafe1Id);
    expect(handed.author).toBeNull();
    expect(handed.maintainer).toBe("由 CoffeeMode 维护");
    expect(handed.work_stats.experience_score).toBeCloseTo(72.5, 2);
    expect(handed.work_stats.composite_score).toBeCloseTo(67.5, 2);
    expect(handed.work_stats.n_users).toBe(2);
    expect(handed.work_stats.n_checkins).toBe(2);
    expect(handed.work_stats.policies.max_stay).toEqual({ "2h": 1 });

    const handedFeed = await getFeed(clientD, cafe1Id);
    expect(handedFeed.status).toBe(200);
    expect(handedFeed.data.checkins.map((c) => c.id).sort()).toEqual(
      [bCheckin1Id, cCheckin1Id].sort(),
    );
    // Act 7 likes survive the handoff: B's check-in still carries both likes.
    const handedHelpful = await getFeed(clientD, cafe1Id, { mode: "helpful" });
    expect(handedHelpful.data.checkins[0]?.id).toBe(bCheckin1Id);
    expect(handedHelpful.data.checkins[0]?.likes_count).toBe(2);

    // Service-account brand is the only owner signal on the nearby surface too.
    const sgNearby = await guestClient.get<NearbyDTO>(cafesGET, "/api/cafes", {
      query: { lat: D_LAT, lng: D_LNG, radius_km: 10 },
    });
    const handedSummary = sgNearby.data.cafes.find((c) => c.id === cafe1Id);
    expect(handedSummary?.maintainer).toBe("由 CoffeeMode 维护");

    // Cafe 2 is untouched by the lifecycle acts.
    const cafe2 = await getCafeDetailAs(clientD, cafe2Id);
    expect(cafe2.work_stats.experience_score).toBeCloseTo(88.33, 2);
    expect(cafe2.work_stats.n_users).toBe(3);
    expect(cafe2.work_stats.n_checkins).toBe(3);

    // Stats settle: A keeps only her Tokyo visit; C keeps her two visits.
    const statsA = await clientA.get<ProfileDTO, NoCtx, NextRequest>(profileGET, "/api/profile");
    expect(statsA.data.stats).toEqual({ cafesCount: 1, checkinsCount: 1 });
    const statsC = await clientC.get<ProfileDTO, NoCtx, NextRequest>(profileGET, "/api/profile");
    expect(statsC.data.stats).toEqual({ cafesCount: 2, checkinsCount: 2 });
    const statsB = await clientB.get<ProfileDTO, NoCtx, NextRequest>(profileGET, "/api/profile");
    expect(statsB.data.stats).toEqual({ cafesCount: 2, checkinsCount: 2 });
  });
});
