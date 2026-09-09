import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as cafesGET } from "@/app/api/cafes/route";
import { GET as recoveryGET } from "@/app/api/cafes/[id]/recovery/route";
import { GET as searchGET } from "@/app/api/search/route";
import {
  createCafeWithFirstCheckIn,
  setCafeVisibility,
} from "@/lib/db/cafes";
import { createCheckIn } from "@/lib/db/checkins";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { isOpenAt } from "@/lib/hours";
import type { SearchResponse } from "@/lib/search/types";
import type { CafeSummary } from "@/types/cafes";
import {
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
  testDatabaseUrl,
} from "../helpers/db";
import {
  apiClient,
  routeParams,
} from "../helpers/http-client";
import { createTestSessionUser } from "../helpers/mocks";
import {
  JOURNEY_U1,
  JOURNEY_U2,
  MOCK_CAFES,
  seedMockDataset,
} from "../fixtures/mock-dataset";

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

interface ErrorBody {
  error: string;
  message: string;
}

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeHttp = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_http_disc");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

// Fixture ids created in beforeAll (service-layer seeding; every assertion
// below drives the product through external HTTP route handlers only).
let farCafeId = "";
let privateCafeId = "";
let tombstoneId = "";

// Query anchor: Orchard Nomad Roasters (SG cluster center).
const SG_LAT = 1.3048;
const SG_LNG = 103.8318;

// ~12.0 km due north of the SG anchor (0.108 deg lat x 111.195 km/deg).
// Inside a 50 km ask, outside the 10 km product cap (DG107).
const FAR_LAT = 1.4128;
const FAR_LNG = 103.8318;

const LONDON_LAT = 51.5136;
const LONDON_LNG = -0.1365;

const guest = apiClient(null);
const creatorU1 = apiClient(
  createTestSessionUser({ id: JOURNEY_U1, displayName: "Journey Ann", currentCity: "singapore" }),
);
const creatorU2 = apiClient(
  createTestSessionUser({ id: JOURNEY_U2, displayName: "Journey Ben", currentCity: "singapore" }),
);

interface CafesBody {
  cafes: CafeSummary[];
}

describeHttp("HTTP Discovery & Filters (Path 1)", () => {
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
    await seedMockDataset(dbClient);

    // 12 km sample for the radius-clamp matrix.
    const far = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: "Far North 12km Sample",
      lat: FAR_LAT,
      lng: FAR_LNG,
      city: "singapore",
      checkin: {
        scores: { overall: 70 },
        max_stay: "unlimited",
        note: "radius clamp probe",
        photo_ids: [],
      },
    });
    farCafeId = far.cafeId;

    // Private London cafe: visible to its creator, invisible to guests.
    const priv = await createCafeWithFirstCheckIn(JOURNEY_U2, {
      name: "Private London Hideout",
      lat: 51.5236,
      lng: -0.1265,
      city: "london",
      checkin: {
        scores: { overall: 80 },
        max_stay: "3h",
        note: "visibility probe",
        photo_ids: [],
      },
    });
    privateCafeId = priv.cafeId;
    await setCafeVisibility(privateCafeId, JOURNEY_U2, "private");

    // Discriminating work-stats for the composite filter matrix:
    // Bugis = high wifi + unlimited stay, Tiong Bahru = low wifi + 2h cap.
    await createCheckIn(JOURNEY_U1, {
      cafe_id: MOCK_CAFES[1]!.id,
      scores: { wifi: 95, outlets: 90, overall: 90 },
      max_stay: "unlimited",
      note: "High wifi and unlimited stay",
    });
    await createCheckIn(JOURNEY_U2, {
      cafe_id: MOCK_CAFES[2]!.id,
      scores: { wifi: 30, outlets: 40, overall: 50 },
      max_stay: "2h",
      note: "Low wifi and 2h cap",
    });

    // Soft-deleted tombstone retaining coordinates for recovery fallback.
    const tomb = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: "Tombstone Recovery Probe",
      lat: 1.305,
      lng: 103.832,
      city: "singapore",
      checkin: {
        scores: { overall: 75 },
        max_stay: "unlimited",
        note: "about to be deleted",
        photo_ids: [],
      },
    });
    tombstoneId = tomb.cafeId;
    await dbClient.query("update cafes set deleted_at = now() where id = $1", [tombstoneId]);
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
      throw new AggregateError(errors, "http-discovery-filters integration cleanup failed");
    }
  });

  // ——— GET /api/cafes spatial matrix ———

  it("Path 1 (DG107): radius_km=50 clamps to the 10km cap — 12km sample excluded", async () => {
    const wide = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: SG_LAT, lng: SG_LNG, radius_km: 50, limit: 50 },
    });
    expect(wide.status).toBe(200);
    const wideIds = wide.data.cafes.map((c) => c.id);

    const capped = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: SG_LAT, lng: SG_LNG, radius_km: 10, limit: 50 },
    });
    expect(capped.status).toBe(200);

    const sortedWide = [...wideIds].sort();
    const sortedCapped = capped.data.cafes.map((c) => c.id).sort();
    expect(sortedWide).toEqual(sortedCapped);
    // The 12km sample is strictly outside the cap despite the 50km ask.
    expect(wideIds).not.toContain(farCafeId);
    // SG cluster present, other continents excluded.
    const names = wide.data.cafes.map((c) => c.name);
    expect(names).toContain("Orchard Nomad Roasters");
    expect(names).toContain("Bugis Outlet Haven");
    expect(names).toContain("Tiong Bahru Quiet Corner");
    expect(names).not.toContain("Shibuya Deep Work Coffee");
    expect(names).not.toContain("Soho Laptop Loft");
  });

  it("Path 1: nearby results sort closest-first with monotonic distance_m", async () => {
    const res = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: SG_LAT, lng: SG_LNG, radius_km: 10, limit: 20 },
    });
    expect(res.status).toBe(200);
    expect(res.data.cafes.length).toBeGreaterThan(0);
    expect(res.data.cafes[0]?.name).toBe("Orchard Nomad Roasters");
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

  it("Path 1 (DG147): anonymous visibility isolation — private cafe hidden from guests", async () => {
    const asGuest = await guest.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: LONDON_LAT, lng: LONDON_LNG, radius_km: 10, limit: 20 },
    });
    expect(asGuest.status).toBe(200);
    const guestIds = asGuest.data.cafes.map((c) => c.id);
    expect(guestIds).not.toContain(privateCafeId);
    expect(asGuest.data.cafes.map((c) => c.name)).toContain("Soho Laptop Loft");

    const asCreator = await creatorU2.get<CafesBody>(cafesGET, "/api/cafes", {
      query: { lat: LONDON_LAT, lng: LONDON_LNG, radius_km: 10, limit: 20 },
    });
    expect(asCreator.status).toBe(200);
    expect(asCreator.data.cafes.map((c) => c.id)).toContain(privateCafeId);
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
    const sgHigh = MOCK_CAFES[1]!.id;
    const sgLow = MOCK_CAFES[2]!.id;
    const res = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_wifi: 80, limit: 20 },
    });
    expect(res.status).toBe(200);
    const ids = res.data.results.map((r) => r.id);
    expect(ids).toContain(sgHigh);
    expect(ids).not.toContain(sgLow);
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

  it("Path 1: filter_max_stay applies ordinal comparison over HTTP", async () => {
    const sgHigh = MOCK_CAFES[1]!.id; // unlimited stay
    const sgLow = MOCK_CAFES[2]!.id; // 2h cap
    const res = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_max_stay: "3h", limit: 20 },
    });
    expect(res.status).toBe(200);
    const ids = res.data.results.map((r) => r.id);
    // "3h" accepts "3h" and "unlimited", rejects "2h".
    expect(ids).toContain(sgHigh);
    expect(ids).not.toContain(sgLow);
  });

  it("Path 1: open_now=true filters by each cafe's IANA timezone over HTTP", async () => {
    const now = new Date();
    const full = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "tokyo", limit: 10 },
    });
    expect(full.status).toBe(200);

    const open = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "tokyo", open_now: "true", limit: 10 },
    });
    expect(open.status).toBe(200);

    const fullIds = new Set(full.data.results.map((r) => r.id));
    const expectedOpen = full.data.results
      .filter(
        (r) =>
          r.type === "cafe" &&
          r.cafe?.opening_hours &&
          r.cafe.tz &&
          isOpenAt(r.cafe.opening_hours, r.cafe.tz, now) === true,
      )
      .map((r) => r.id);
    // open_now is a pure narrowing over the same city set, evaluated per
    // venue in its own IANA timezone.
    const openIds = open.data.results.map((r) => r.id).sort();
    expect(openIds).toEqual(expectedOpen.sort());
    for (const id of open.data.results.map((r) => r.id)) {
      expect(fullIds.has(id)).toBe(true);
    }
  });

  // ——— Weak-result fallback + recovery (DG111/DG112) ———

  it("Path 1: gibberish keyword returns 200 with is_weak_results fallback flag", async () => {
    const res = await guest.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", q: "zzz-no-such-cafe-xyz", limit: 10 },
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
      `/api/cafes/${tombstoneId}/recovery`,
      {},
      routeParams({ id: tombstoneId }),
    );
    expect(res.status).toBe(200);
    expect(res.data.cafes.length).toBeGreaterThan(0);
    expect(res.data.cafes.every((c) => c.id !== tombstoneId)).toBe(true);

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
    const res = await creatorU1.get<SearchResponse>(searchGET, "/api/search", {
      query: { city: "singapore", filter_wifi: 80, limit: 20 },
    });
    expect(res.status).toBe(200);
    const ids = res.data.results.map((r) => r.id);
    expect(ids).toContain(MOCK_CAFES[1]!.id);
    expect(ids).not.toContain(MOCK_CAFES[2]!.id);
  });
});
