import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as cafesGET, POST as cafesPOST } from "@/app/api/cafes/route";
import { DELETE as cafeDELETE } from "@/app/api/cafes/[id]/route";
import { PATCH as visibilityPATCH } from "@/app/api/cafes/[id]/visibility/route";
import { GET as recoveryGET } from "@/app/api/cafes/[id]/recovery/route";
import { POST as checkinsPOST } from "@/app/api/checkins/route";
import { POST as uploadPOST } from "@/app/api/images/upload/route";
import { GET as searchGET } from "@/app/api/search/route";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import type { SearchResponse } from "@/lib/search/types";
import type { CafeSummary } from "@/types/cafes";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import {
  apiClient,
  createHttpTestUsers,
  resetRateLimits,
  routeParams,
  seedHttpTestUsers,
  type ApiClient,
} from "../helpers/http-client";

// Auth runs through the http-client mock seam: every request programs
// getCurrentUser() to the calling client's identity (or null for guests).
vi.mock("@/lib/auth/get-user", () => ({ getCurrentUser: vi.fn() }));

// Stub POI worker so search operations never hit external services.
vi.mock("@/lib/places/poi-client", () => ({
  searchExternalPOIs: vi.fn(async () => ({ results: [] })),
  searchPOIs: vi.fn(async () => ({ results: [] })),
  resolveMapsUrl: vi.fn(),
  getPOI: vi.fn(),
}));

// Image-client seam mock (spec 0008 §5 preference order): the upload and
// create route handlers stay real; only the worker round-trip is faked.
// Intents are still recorded in the real table through POST /api/images/upload.
vi.mock("@/lib/images/image-service-client", () => ({
  requestUploadUrl: vi.fn(async (size: number) => ({
    imageUuid: randomUUID(),
    uploadUrl: "http://images.test/upload",
    uploadHeaders: {},
    publicUrl: "http://images.test/original.webp",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    maxUploadBytes: 10_000_000,
    size,
  })),
  getProcessUrls: vi.fn(async ({ imageUuid }: { imageUuid: string }) => ({
    imageUuid,
    original: { url: `http://images.test/${imageUuid}`, headers: {} },
    originalPut: { url: `http://images.test/${imageUuid}`, headers: {} },
    card: { url: `http://images.test/${imageUuid}/card`, headers: {} },
    thumbnail: { url: `http://images.test/${imageUuid}/thumb`, headers: {} },
    publicUrls: {
      original: `http://images.test/${imageUuid}.webp`,
      card: `http://images.test/${imageUuid}-card.webp`,
      thumbnail: `http://images.test/${imageUuid}-thumb.webp`,
    },
    keys: {
      original: `original/${imageUuid}.webp`,
      card: `card/${imageUuid}.webp`,
      thumbnail: `thumbnail/${imageUuid}.webp`,
    },
  })),
}));

vi.mock("@/lib/images/processor", () => ({
  processImage: vi.fn(async (imageUuid: string) => ({
    imageUuid,
    publicUrls: {
      original: `http://images.test/${imageUuid}.webp`,
      card: `http://images.test/${imageUuid}-card.webp`,
      thumbnail: `http://images.test/${imageUuid}-thumb.webp`,
    },
    width: 800,
    height: 600,
  })),
}));

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeHttp = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_http_disc");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

interface ErrorBody {
  error: string;
  message: string;
}

interface CafesBody {
  cafes: CafeSummary[];
}

interface CreateCafeBody {
  cafeId: string;
  checkinId: string;
  tz: string;
}

interface UploadBody {
  imageUuid: string;
}

interface CheckinBody {
  checkinId: string;
}

const users = createHttpTestUsers();
const guest = apiClient(null);
const userA = apiClient(users.userA);
const userB = apiClient(users.userB);
const userC = apiClient(users.userC);

// Fixture cafe ids, created through HTTP in beforeAll.
const cafeIds: Record<string, string> = {};

const ALWAYS_OPEN = { lat: 1.306, lng: 103.833 };
const ALWAYS_OPEN_HOURS = {
  mon: { open: "00:00", close: "00:00" },
  tue: { open: "00:00", close: "00:00" },
  wed: { open: "00:00", close: "00:00" },
  thu: { open: "00:00", close: "00:00" },
  fri: { open: "00:00", close: "00:00" },
  sat: { open: "00:00", close: "00:00" },
  sun: { open: "00:00", close: "00:00" },
};
const ALL_CLOSED_HOURS = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
};

async function createCafe(
  client: ApiClient,
  body: Record<string, unknown>,
): Promise<string> {
  const upload = await client.post<UploadBody>(uploadPOST, "/api/images/upload", { size: 44 });
  expect(upload.status).toBe(200);
  const created = await client.post<CreateCafeBody>(cafesPOST, "/api/cafes", {
    ...body,
    checkin: {
      ...(body.checkin as Record<string, unknown>),
      photo_ids: [upload.data.imageUuid],
    },
  });
  expect(created.status).toBe(201);
  return created.data.cafeId;
}

async function postCheckin(
  client: ApiClient,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await client.post<CheckinBody>(checkinsPOST, "/api/checkins", body);
  expect([200, 201]).toContain(res.status);
  return res.status;
}

describeHttp("HTTP Discovery & Filters (Path 1)", () => {
  beforeAll(async () => {
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
    // Fresh template clone: no truncate. Personas come from the
    // harness-owned seeder (spec 0008 §1, seam 1).
    await seedHttpTestUsers(dbClient, users);
    await resetRateLimits();

    // Deterministic open_now trio (spec 0008 §4): always-open, explicit
    // null closed days, and no opening_hours at all.
    cafeIds.alwaysOpen = await createCafe(userA, {
      name: "Always Open Corner",
      lat: ALWAYS_OPEN.lat,
      lng: ALWAYS_OPEN.lng,
      city: "singapore",
      opening_hours: ALWAYS_OPEN_HOURS,
      checkin: {
        scores: { overall: 70, wifi: 50 },
        max_stay: "unlimited",
        note: "open around the clock",
      },
    });
    cafeIds.closedDays = await createCafe(userB, {
      name: "Closed Days Corner",
      lat: 1.307,
      lng: 103.834,
      city: "singapore",
      opening_hours: ALL_CLOSED_HOURS,
      checkin: {
        scores: { overall: 70, wifi: 50 },
        max_stay: "unlimited",
        note: "never open",
      },
    });
    cafeIds.noHours = await createCafe(userC, {
      name: "No Hours Corner",
      lat: 1.308,
      lng: 103.835,
      city: "singapore",
      checkin: {
        scores: { overall: 70, wifi: 50 },
        max_stay: "unlimited",
        note: "hours unknown",
      },
    });

    // Radius boundary pair (spec edge case 1): ~9.5km in, ~12km out.
    cafeIds.nearProbe = await createCafe(userA, {
      name: "Near Probe 9km",
      lat: 1.3902,
      lng: 103.8318,
      city: "singapore",
      checkin: {
        scores: { overall: 70, wifi: 50 },
        max_stay: "unlimited",
        note: "inside the cap",
      },
    });
    cafeIds.farProbe = await createCafe(userB, {
      name: "Far Probe 12km",
      lat: 1.4128,
      lng: 103.8318,
      city: "singapore",
      checkin: {
        scores: { overall: 70, wifi: 50 },
        max_stay: "unlimited",
        note: "outside the cap",
      },
    });

    // Private London cafe: visible to its creator, invisible to guests.
    cafeIds.privateLondon = await createCafe(userB, {
      name: "Private London Hideout",
      lat: 51.5236,
      lng: -0.1265,
      city: "london",
      checkin: {
        scores: { overall: 80, wifi: 50 },
        max_stay: "3h",
        note: "visibility probe",
      },
    });
    const vis = await userB.patch(
      visibilityPATCH,
      `/api/cafes/${cafeIds.privateLondon}/visibility`,
      { visibility: "private" },
      {},
      routeParams({ id: cafeIds.privateLondon }),
    );
    expect(vis.status).toBe(200);

    // Sole-owner cafe, deleted through HTTP into a DG146 empty shell whose
    // location tombstone powers the recovery fallback.
    cafeIds.tombstone = await createCafe(userC, {
      name: "Tombstone Tea Room",
      lat: 1.305,
      lng: 103.832,
      city: "singapore",
      checkin: {
        scores: { overall: 75, wifi: 50 },
        max_stay: "unlimited",
        note: "about to be deleted",
      },
    });
    const del = await userC.delete(
      cafeDELETE,
      `/api/cafes/${cafeIds.tombstone}`,
      undefined,
      {},
      routeParams({ id: cafeIds.tombstone }),
    );
    expect(del.status).toBe(200);

    // Composite filter fixtures: high vs low wifi consensus.
    cafeIds.wifiHigh = await createCafe(userA, {
      name: "Wifi High House",
      lat: 1.31,
      lng: 103.836,
      city: "singapore",
      checkin: {
        scores: { wifi: 95, outlets: 90, overall: 90 },
        max_stay: "unlimited",
        note: "fast wifi",
      },
    });
    cafeIds.wifiLow = await createCafe(userB, {
      name: "Wifi Low House",
      lat: 1.311,
      lng: 103.837,
      city: "singapore",
      checkin: {
        scores: { wifi: 30, outlets: 40, overall: 50 },
        max_stay: "2h",
        note: "slow wifi",
      },
    });
    await postCheckin(userB, {
      cafe_id: cafeIds.wifiHigh,
      scores: { wifi: 90, outlets: 88, overall: 88 },
      max_stay: "unlimited",
      note: "confirms fast wifi",
    });
    await postCheckin(userA, {
      cafe_id: cafeIds.wifiLow,
      scores: { wifi: 35, outlets: 42, overall: 52 },
      max_stay: "2h",
      note: "confirms slow wifi",
    });

    // max_stay ordinal fixture (spec 0008 §4): two users both reporting 3h.
    cafeIds.stayThree = await createCafe(userA, {
      name: "Stay Three House",
      lat: 1.312,
      lng: 103.838,
      city: "singapore",
      checkin: {
        scores: { overall: 75, wifi: 50 },
        max_stay: "3h",
        note: "three hour stay",
      },
    });
    await postCheckin(userB, {
      cafe_id: cafeIds.stayThree,
      scores: { overall: 78, wifi: 50 },
      max_stay: "3h",
      note: "agrees three hours",
    });

    // Tokyo anchor for the city-switch matrix.
    cafeIds.tokyo = await createCafe(userB, {
      name: "Tokyo Switch Coffee",
      lat: 35.6595,
      lng: 139.7005,
      city: "tokyo",
      checkin: {
        scores: { overall: 80, wifi: 50 },
        max_stay: "3h",
        note: "shibuya work spot",
      },
    });

    await resetRateLimits();
  }, 180_000);

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
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (error) {
        errors.push(error);
      }
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (errors.length > 0) {
      throw new AggregateError(errors, "http-discovery-filters integration cleanup failed");
    }
  }, 60_000);

  // ——— GET /api/cafes spatial matrix ———

  it("Path 1 (DG107): radius_km=50 clamps to the 10km cap — 12km out, 9.5km in", async () => {
    const wide = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: ALWAYS_OPEN.lat, lng: ALWAYS_OPEN.lng, radius_km: 50, limit: 50 },
    });
    expect(wide.status).toBe(200);
    const wideIds = wide.data.cafes.map((c) => c.id);

    const capped = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: ALWAYS_OPEN.lat, lng: ALWAYS_OPEN.lng, radius_km: 10, limit: 50 },
    });
    expect(capped.status).toBe(200);

    // Clamp equivalence: the 50km ask returns exactly the 10km set.
    const sortedWide = [...wideIds].sort();
    const sortedCapped = capped.data.cafes.map((c) => c.id).sort();
    expect(sortedWide).toEqual(sortedCapped);
    // Containment, not meter equality (spec edge case 1).
    expect(wideIds).not.toContain(cafeIds.farProbe);
    expect(wideIds).toContain(cafeIds.nearProbe);
    expect(wideIds).toContain(cafeIds.alwaysOpen);
  });

  it("Path 1: nearby results sort closest-first with monotonic distance_m", async () => {
    const res = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: ALWAYS_OPEN.lat, lng: ALWAYS_OPEN.lng, radius_km: 10, limit: 20 },
    });
    expect(res.status).toBe(200);
    expect(res.data.cafes.length).toBeGreaterThan(0);
    expect(res.data.cafes[0]?.name).toBe("Always Open Corner");
    for (let i = 1; i < res.data.cafes.length; i += 1) {
      expect(res.data.cafes[i - 1]?.distance_m).toBeLessThanOrEqual(
        res.data.cafes[i]?.distance_m ?? Number.POSITIVE_INFINITY,
      );
    }
  });

  it("Path 1: empty ocean region returns 200 { cafes: [] }", async () => {
    const res = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: 0, lng: -140, radius_km: 10, limit: 20 },
    });
    expect(res.status).toBe(200);
    expect(res.data.cafes).toEqual([]);
  });

  it("Path 1: /api/cafes rejects bad coords/limit with 400 invalid_request", async () => {
    for (const query of [
      { lng: 103.8 },
      { lat: 1.35 },
      { lat: "abc", lng: 103.8 },
      { lat: 1.35, lng: "abc" },
      { lat: 1.35, lng: 103.8, limit: 0 },
    ]) {
      const res = await guest.get<ErrorBody>(cafesGET, "/api/cafes", { query });
      expect(res.status).toBe(400);
      expect(res.data.error).toBe("invalid_request");
    }
  });

  it("Path 1 (DG13): CafeSummary never leaks created_by", async () => {
    const res = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: ALWAYS_OPEN.lat, lng: ALWAYS_OPEN.lng, radius_km: 10, limit: 50 },
    });
    expect(res.status).toBe(200);
    expect(res.data.cafes.length).toBeGreaterThan(0);
    for (const cafe of res.data.cafes) {
      expect(cafe).not.toHaveProperty("created_by");
    }
  });

  it("Path 1 (DG147): anonymous visibility isolation — private cafe hidden from guests", async () => {
    const asGuest = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: 51.5136, lng: -0.1365, radius_km: 10, limit: 20 },
    });
    expect(asGuest.status).toBe(200);
    expect(asGuest.data.cafes.map((c) => c.id)).not.toContain(cafeIds.privateLondon);

    const asCreator = await userB.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: 51.5136, lng: -0.1365, radius_km: 10, limit: 20 },
    });
    expect(asCreator.status).toBe(200);
    expect(asCreator.data.cafes.map((c) => c.id)).toContain(cafeIds.privateLondon);
  });

  // ——— GET /api/search city matrix (DG128) ———

  it("Path 1 (DG128): explicit unknown city returns 400 invalid_request", async () => {
    const res = await guest.get<ErrorBody>(searchGET, "/api/search", {
      query: { city: "atlantis" },
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe("invalid_request");
  });

  it("Path 1 (DG128): omitted city resolves via cf-ipcity header", async () => {
    const res = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { q: "coffee" },
      headers: { "cf-ipcity": "Tokyo", "cf-ipcountry": "JP" },
    });
    expect(res.status).toBe(200);
    expect(res.data.reference_point.city_id).toBe("tokyo");
    for (const item of res.data.results) {
      if (item.type === "cafe" && item.cafe) {
        expect(item.cafe.city).toBe("tokyo");
      }
    }
    expect(res.data.results.map((r) => r.id)).toContain(cafeIds.tokyo);
    // DG132/DG137-B: success path carries observability + cache headers.
    expect(res.headers.get("X-Search-Mode")).toBe("stored_only");
    expect(res.headers.get("Cache-Control")).toContain("max-age=10");

    const countryFallback = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { q: "coffee" },
      headers: { "cf-ipcity": "Nowhere", "cf-ipcountry": "SG" },
    });
    expect(countryFallback.status).toBe(200);
    expect(countryFallback.data.reference_point.city_id).toBe("singapore");
  });

  // ——— GET /api/search composite filters ———

  it("Path 1: wifi threshold narrows the set over HTTP", async () => {
    const res = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_wifi: 80, limit: 20 },
    });
    expect(res.status).toBe(200);
    const ids = res.data.results.map((r) => r.id);
    expect(ids).toContain(cafeIds.wifiHigh);
    expect(ids).not.toContain(cafeIds.wifiLow);
  });

  it("Path 1: out-of-range score filter is lenient — 200 with unfiltered total", async () => {
    const unfiltered = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", limit: 20 },
    });
    expect(unfiltered.status).toBe(200);

    // Out-of-range score values are ignored (never a 400) — 200 with the
    // unfiltered total.
    const clamped = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_wifi: 150, limit: 20 },
    });
    expect(clamped.status).toBe(200);
    expect(clamped.data.total_count).toBe(unfiltered.data.total_count);

    const negative = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_wifi: -5, limit: 20 },
    });
    expect(negative.status).toBe(200);
    expect(negative.data.total_count).toBe(unfiltered.data.total_count);
  });

  it("Path 1: filter_max_stay applies ordinal consensus over HTTP (3h pair)", async () => {
    // Two users both reporting 3h: in for filter_max_stay=3h ...
    const three = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_max_stay: "3h", limit: 20 },
    });
    expect(three.status).toBe(200);
    expect(three.data.results.map((r) => r.id)).toContain(cafeIds.stayThree);
    // ... out for filter_max_stay=unlimited (3h consensus ranks below it).
    const unlimited = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_max_stay: "unlimited", limit: 20 },
    });
    expect(unlimited.status).toBe(200);
    expect(unlimited.data.results.map((r) => r.id)).not.toContain(cafeIds.stayThree);
  });

  it("Path 1: open_now=true uses the deterministic fixture trio, never wall-clock", async () => {
    const open = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", open_now: "true", limit: 20 },
    });
    expect(open.status).toBe(200);
    const ids = open.data.results.map((r) => r.id);
    // Always-open (00:00–00:00 daily) included at any instant; explicit
    // null closed days and unknown hours excluded at any instant.
    expect(ids).toContain(cafeIds.alwaysOpen);
    expect(ids).not.toContain(cafeIds.closedDays);
    expect(ids).not.toContain(cafeIds.noHours);
  });

  // ——— Weak-result fallback + recovery (DG111/DG112, DG146 shell) ———

  it("Path 1: impossible filter combination returns honest 200 empty state", async () => {
    const res = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", q: "zzz-no-such-cafe-xyz", filter_overall: 100, limit: 10 },
    });
    expect(res.status).toBe(200);
    expect(res.data.results).toHaveLength(0);
    expect(res.data.total_count).toBe(0);
    expect(res.data.is_weak_results).toBe(true);
  });

  it("Path 1 (DG111/DG112): recovery suggests nearby alternatives excluding the gone cafe", async () => {
    type RecoveryCtx = { params: Promise<{ id: string }> };
    const res = await guest.get<CafesBody, RecoveryCtx>(
      recoveryGET,
      `/api/cafes/${cafeIds.tombstone}/recovery`,
      {},
      routeParams({ id: cafeIds.tombstone }),
    );
    expect(res.status).toBe(200);
    expect(res.data.cafes.length).toBeGreaterThan(0);
    expect(res.data.cafes.every((c) => c.id !== cafeIds.tombstone)).toBe(true);

    const missingId = randomUUID();
    const missing = await guest.get<CafesBody, RecoveryCtx>(
      recoveryGET,
      `/api/cafes/${missingId}/recovery`,
      {},
      routeParams({ id: missingId }),
    );
    expect(missing.status).toBe(200);
    expect(missing.data.cafes).toEqual([]);
  });

  it("Path 1: authenticated search carries viewer identity without breaking filters", async () => {
    const res = await userA.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_wifi: 80, limit: 20 },
    });
    expect(res.status).toBe(200);
    const ids = res.data.results.map((r) => r.id);
    expect(ids).toContain(cafeIds.wifiHigh);
    expect(ids).not.toContain(cafeIds.wifiLow);
  });
});
