/**
 * Core backend user-journey matrix (spec 0007 / BRAWUKA-143)
 * Paths 1→3: Discovery & filters, cafe creation with photo upload, profile & identity toggle.
 *
 * Runs against real Postgres/PostGIS when RUN_INTEGRATION=1.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CafeExistsError } from "@/lib/validation/cafe";
import {
  createCafeWithFirstCheckIn,
  getCafe,
  getCafeLocation,
  listCafesNearby,
  toPublicCafeDetail,
} from "@/lib/db/cafes";
import { createCheckIn } from "@/lib/db/checkins";
import type { MaxStay } from "@/types/checkins";
import { PUBLIC_HANDLE_REGEX, updateProfileIdentity } from "@/lib/db/identity";
import { getProfile, updateProfile } from "@/lib/db/profile";
import { searchCafesInDb } from "@/lib/db/search";
import { listPublicCheckIns } from "@/lib/discovery/feed";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
} from "@/lib/images/complete";
import { executeSearch } from "@/lib/search/search-service";
import { GET as recoveryGET } from "@/app/api/cafes/[id]/recovery/route";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import { cafeWorkStats, fakeProcessUrls } from "../helpers/fixtures";
import {
  createFakeImageUpload,
  createMockGooglePlacesResponse,
} from "../helpers/mocks";
import {
  JOURNEY_U1,
  JOURNEY_U2,
  MOCK_CAFES,
  seedMockDataset,
} from "../fixtures/mock-dataset";

// Stub POI worker so search operations never hit external services.
vi.mock("@/lib/places/poi-client", () => ({
  searchExternalPOIs: vi.fn(async () => ({ results: [] })),
  searchPOIs: vi.fn(async () => ({ results: [] })),
  resolveMapsUrl: vi.fn(),
  getPOI: vi.fn(),
}));

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeJourney = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_journey_dc");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

// Track per-test created resources for afterEach cleanup
const createdCafeIds = new Set<string>();
const createdUserIds = new Set<string>();
function imageStubDeps() {
  return {
    ...defaultCompleteUploadDeps(),
    getProcessUrls: async (request: { imageUuid: string }) =>
      fakeProcessUrls(request.imageUuid),
    processImage: async (imageUuid: string) => ({
      imageUuid,
      publicUrls: fakeProcessUrls(imageUuid).publicUrls,
      width: 800,
      height: 600,
    }),
  };
}

describeJourney("User Journey: Discovery, Creation & Identity (Paths 1→3)", () => {
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
  }, 120_000);

  afterEach(async () => {
    for (const cafeId of createdCafeIds) {
      await dbClient.query("delete from checkin_likes where checkin_id in (select id from checkins where cafe_id = $1)", [cafeId]);
      await dbClient.query("delete from checkins where cafe_id = $1", [cafeId]);
      await dbClient.query("delete from cafes where id = $1", [cafeId]);
    }
    createdCafeIds.clear();
    for (const userId of createdUserIds) {
      await dbClient.query("delete from profiles where id = $1", [userId]);
    }
    createdUserIds.clear();
  });

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
      throw new AggregateError(errors, "discovery-creation journey integration cleanup failed");
    }
  }, 60_000);

  // =========================================================================
  // Path 1: Discovery & Filters
  // =========================================================================

  it("Path 1: nearby 10km map load returns Singapore cafes closest-first, excluding Tokyo", async () => {
    const nearby = await listCafesNearby({
      lat: 1.3048,
      lng: 103.8318,
      radiusKm: 10,
      limit: 20,
    });
    const names = nearby.map((c) => c.name);
    expect(names).toContain("Orchard Nomad Roasters");
    expect(names).toContain("Bugis Outlet Haven");
    expect(names).toContain("Tiong Bahru Quiet Corner");
    expect(names).not.toContain("Shibuya Deep Work Coffee");
    expect(names).not.toContain("Soho Laptop Loft");

    // Closest-first: first item is Orchard at query point (distance ~0m)
    expect(nearby[0]?.name).toBe("Orchard Nomad Roasters");
    for (let i = 1; i < nearby.length; i += 1) {
      expect(nearby[i - 1]?.distance_m).toBeLessThanOrEqual(
        nearby[i]?.distance_m ?? Number.POSITIVE_INFINITY,
      );
    }
  });

  it("Path 1: city dimension filtering scopes to Tokyo and keyword scopes by name", async () => {
    const tokyoCafes = await searchCafesInDb({ city: "tokyo", limit: 20 });
    expect(tokyoCafes).toHaveLength(2);
    expect(tokyoCafes.map((c) => c.city).every((city) => city === "tokyo")).toBe(true);

    const keyword = await searchCafesInDb({ q: "Shibuya", limit: 20 });
    expect(keyword.map((c) => c.name)).toContain("Shibuya Deep Work Coffee");
    expect(keyword.map((c) => c.name)).not.toContain("Orchard Nomad Roasters");

    const sgKeyword = await searchCafesInDb({ city: "singapore", q: "Orchard", limit: 20 });
    expect(sgKeyword.map((c) => c.name)).toEqual(["Orchard Nomad Roasters"]);
  });

  it("Path 1: nomad composite filters push down minimum work scores and max_stay duration", async () => {
    const [sgHigh, sgLow] = [MOCK_CAFES[1]!.id, MOCK_CAFES[2]!.id];
    // Seed distinct check-in attributes on two Singapore cafes
    await createCheckIn(JOURNEY_U1, {
      cafe_id: sgHigh,
      scores: { wifi: 95, outlets: 90, overall: 90 },
      max_stay: "unlimited",
      note: "High wifi and unlimited stay",
    });
    await createCheckIn(JOURNEY_U2, {
      cafe_id: sgLow,
      scores: { wifi: 30, outlets: 40, overall: 50 },
      max_stay: "2h",
      note: "Low wifi and 2h cap",
    });

    // Wifi threshold pushdown
    const wifiFiltered = await searchCafesInDb({
      city: "singapore",
      filter_wifi: 80,
      limit: 20,
    });
    const wifiIds = wifiFiltered.map((c) => c.id);
    expect(wifiIds).toContain(sgHigh);
    expect(wifiIds).not.toContain(sgLow);

    // Outlets threshold pushdown
    const outletsFiltered = await searchCafesInDb({
      city: "singapore",
      filter_outlets: 80,
      limit: 20,
    });
    expect(outletsFiltered.map((c) => c.id)).toContain(sgHigh);
    expect(outletsFiltered.map((c) => c.id)).not.toContain(sgLow);

    // Stay duration filter (filter_max_stay: "3h" accepts "3h" and "unlimited", rejects "2h")
    const stayFiltered = await searchCafesInDb({
      city: "singapore",
      filter_max_stay: "3h",
      limit: 20,
    });
    const stayIds = stayFiltered.map((c) => c.id);
    expect(stayIds).toContain(sgHigh);
    expect(stayIds).not.toContain(sgLow);

    // Strict unlimited stay filter
    const unlimitedFiltered = await searchCafesInDb({
      city: "singapore",
      filter_max_stay: "unlimited",
      limit: 20,
    });
    expect(unlimitedFiltered.map((c) => c.id)).toContain(sgHigh);
    expect(unlimitedFiltered.map((c) => c.id)).not.toContain(sgLow);

    // Boundary assertion (spec 0007 §10): unknown filter_max_stay is safely ignored
    const unknownStayFiltered = await searchCafesInDb({
      city: "singapore",
      filter_max_stay: "invalid_stay_label" as unknown as MaxStay,
      limit: 20,
    });
    expect(unknownStayFiltered.map((c) => c.id)).toContain(sgHigh);
    expect(unknownStayFiltered.map((c) => c.id)).toContain(sgLow);
  });

  it("Path 1: timezone-aware open_now evaluates real operational hours dynamically", async () => {
    // Deterministic test instant: Monday at 12:00:00 Tokyo time (UTC 2026-09-07T03:00:00Z)
    // - Shibuya Deep Work Coffee: Monday 08:00-22:00 -> OPEN
    // - Shimokitazawa Slow Bar: Monday null -> CLOSED
    const mondayNoonTokyo = new Date("2026-09-07T03:00:00.000Z");

    const openNowSearch = await executeSearch(
      { city: "tokyo", open_now: true, limit: 10 },
      mondayNoonTokyo,
    );
    const openNames = openNowSearch.results.map((r) => r.name);
    expect(openNames).toContain("Shibuya Deep Work Coffee");
    expect(openNames).not.toContain("Shimokitazawa Slow Bar");

    // Late night instant: Monday at 23:30:00 Tokyo time (UTC 2026-09-07T14:30:00Z)
    // Both cafes in Tokyo are closed.
    const mondayNightTokyo = new Date("2026-09-07T14:30:00.000Z");
    const lateNightSearch = await executeSearch(
      { city: "tokyo", open_now: true, limit: 10 },
      mondayNightTokyo,
    );
    expect(lateNightSearch.results).toHaveLength(0);
  });

  it("Path 1: empty result recovery fallback provides nearby alternatives for gone cafes (DG111/DG112)", async () => {
    // Create a temporary cafe to simulate a soft-deleted tombstone
    const temp = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: "Tombstone Recovery Test Venue",
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
    const tombstoneId = temp.cafeId;

    // Soft-delete: retain coordinates tombstone
    await dbClient.query("update cafes set deleted_at = now() where id = $1", [tombstoneId]);

    // getCafeLocation still retrieves coordinates of soft-deleted cafe for recovery
    const location = await getCafeLocation(tombstoneId);
    expect(location).not.toBeNull();
    expect(location?.lat).toBeCloseTo(1.305, 3);
    expect(location?.lng).toBeCloseTo(103.832, 3);

    // Call GET /api/cafes/[id]/recovery endpoint
    const recoveryRes = await recoveryGET(
      new Request(`https://localhost/api/cafes/${tombstoneId}/recovery`),
      { params: Promise.resolve({ id: tombstoneId }) },
    );
    expect(recoveryRes.status).toBe(200);
    const recoveryData = (await recoveryRes.json()) as { cafes: Array<{ id: string; name: string }> };
    expect(recoveryData.cafes.length).toBeGreaterThan(0);
    // Crucial recovery invariant: the gone cafe itself is strictly excluded from suggestions
    expect(recoveryData.cafes.every((c) => c.id !== tombstoneId)).toBe(true);

    // Non-existent UUID gracefully returns an empty list without 500 error
    const nonExistentId = randomUUID();
    const missingRes = await recoveryGET(
      new Request(`https://localhost/api/cafes/${nonExistentId}/recovery`),
      { params: Promise.resolve({ id: nonExistentId }) },
    );
    expect(missingRes.status).toBe(200);
    const missingData = (await missingRes.json()) as { cafes: unknown[] };
    expect(missingData.cafes).toEqual([]);
  });

  // =========================================================================
  // Path 2: Cafe Creation & Photo Pipeline
  // =========================================================================

  it("Path 2: mock Google POI injection validates place_id persistence and prevents duplicate collision", async () => {
    const uniquePlaceId = `ChIJTESTJOURNEYPOI_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const mockPoi = createMockGooglePlacesResponse({
      place_id: uniquePlaceId,
      name: "Google POI Seed Roasters",
      address: "100 Orchard Blvd, Singapore",
      lat: 1.3042,
      lng: 103.8322,
    }).results[0]!;

    // POI schema boundary validation
    expect(mockPoi.place_id).toBe(uniquePlaceId);
    expect(mockPoi.source).toBe("google");
    expect(mockPoi.business_status).toBe("OPERATIONAL");
    expect(mockPoi.types).toContain("cafe");

    // Inject POI into creation flow
    const created = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: mockPoi.name,
      lat: mockPoi.lat,
      lng: mockPoi.lng,
      address: mockPoi.address ?? undefined,
      city: "singapore",
      google_place_id: mockPoi.place_id,
      checkin: {
        scores: { overall: 85, wifi: 88, outlets: 80 },
        max_stay: "unlimited",
        note: "Created via Google POI injection",
        photo_ids: [],
      },
    });
    expect(created.cafeId).toBeDefined();
    createdCafeIds.add(created.cafeId);

    // Verify google_place_id persistence in DB
    const persisted = await dbClient.query(
      "select google_place_id from cafes where id = $1",
      [created.cafeId],
    );
    expect(persisted.rows[0]?.google_place_id).toBe(mockPoi.place_id);

    // Verify search retrieval includes external ID
    const searchResult = await searchCafesInDb({ q: "Google POI Seed Roasters", limit: 5 });
    expect(searchResult[0]?.google_place_id).toBe(mockPoi.place_id);

    // Collision integrity: re-importing the same google_place_id must throw CafeExistsError
    await expect(
      createCafeWithFirstCheckIn(JOURNEY_U2, {
        name: "Duplicate Google POI Attempt",
        lat: mockPoi.lat,
        lng: mockPoi.lng,
        city: "singapore",
        google_place_id: mockPoi.place_id,
        checkin: {
          scores: { overall: 70 },
          max_stay: "2h",
          note: "Should be rejected",
          photo_ids: [],
        },
      }),
    ).rejects.toThrow(CafeExistsError);
  });

  it("Path 2: photo upload pipeline consumes WebP upload intent and atomically mounts into gallery", async () => {
    // 1. Create a flagship journey cafe
    const flagship = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: "Flagship Journey Roasters",
      lat: 1.3065,
      lng: 103.8325,
      address: "10 Orchard Gate, Singapore",
      city: "singapore",
      checkin: {
        scores: { overall: 85, wifi: 90, outlets: 85, seats: 80, coffee: 90 },
        max_stay: "unlimited",
        note: "Initial impression for journey verification",
        photo_ids: [],
      },
    });
    expect(flagship.tz).toBe("Asia/Singapore");
    createdCafeIds.add(flagship.cafeId);
    const journeyCafeId = flagship.cafeId;

    // 2. WebP fake image upload fixture
    const fakeUpload = createFakeImageUpload();
    expect(fakeUpload.contentType).toBe("image/webp");
    expect(fakeUpload.size).toBeGreaterThan(0);

    // Unrecorded intent must fail
    const unrecordedResult = await completeImageUpload(
      { id: JOURNEY_U1 },
      { imageUuid: fakeUpload.imageUuid, targetType: "cafe", targetId: journeyCafeId, isCover: false },
      imageStubDeps(),
    );
    expect(unrecordedResult.ok).toBe(false);
    if (!unrecordedResult.ok) {
      expect(unrecordedResult.reason).toBe("intent_not_found");
    }

    // Record intent and complete upload
    await recordUploadIntent(JOURNEY_U1, fakeUpload.imageUuid);
    const completeResult = await completeImageUpload(
      { id: JOURNEY_U1 },
      { imageUuid: fakeUpload.imageUuid, targetType: "cafe", targetId: journeyCafeId, isCover: false },
      imageStubDeps(),
    );
    expect(completeResult.ok).toBe(true);
    expect(completeResult.storedImage?.id).toBe(fakeUpload.imageUuid);

    // Verify atomic mount into cafes.gallery in Postgres
    const galleryRes = await dbClient.query(
      "select gallery from cafes where id = $1",
      [journeyCafeId],
    );
    const gallery = galleryRes.rows[0]?.gallery as Array<{ id: string }>;
    expect(gallery).toBeInstanceOf(Array);
    expect(gallery.some((img) => img.id === fakeUpload.imageUuid)).toBe(true);

    // Single-use intent guarantee: re-completing the same intent must fail
    const replayResult = await completeImageUpload(
      { id: JOURNEY_U1 },
      { imageUuid: fakeUpload.imageUuid, targetType: "cafe", targetId: journeyCafeId, isCover: false },
      imageStubDeps(),
    );
    expect(replayResult.ok).toBe(false);
    if (!replayResult.ok) {
      expect(replayResult.reason).toBe("intent_not_found");
    }

    // User isolation guarantee: another user cannot complete U1's intent
    const foreignUpload = createFakeImageUpload();
    await recordUploadIntent(JOURNEY_U1, foreignUpload.imageUuid);
    const foreignResult = await completeImageUpload(
      { id: JOURNEY_U2 },
      { imageUuid: foreignUpload.imageUuid, targetType: "cafe", targetId: journeyCafeId, isCover: false },
      imageStubDeps(),
    );
    expect(foreignResult.ok).toBe(false);
    if (!foreignResult.ok) {
      expect(foreignResult.reason).toBe("intent_not_found");
    }
  });

  it("Path 2: fused creation transaction produces initial work_stats and guarantees default anonymity", async () => {
    const flagship = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: `Fused Stats Roasters ${randomUUID().slice(0, 8)}`,
      lat: 1.3065,
      lng: 103.8325,
      address: "10 Orchard Gate, Singapore",
      city: "singapore",
      checkin: {
        scores: { overall: 85, wifi: 90, outlets: 85, seats: 80, coffee: 90 },
        max_stay: "unlimited",
        note: "Initial impression for journey verification",
        photo_ids: [],
      },
    });
    createdCafeIds.add(flagship.cafeId);

    // Verify coordinates, timezone, city, and initial aggregated stats
    const stats = await cafeWorkStats(dbClient, flagship.cafeId);
    expect(stats.n_checkins).toBe(1);
    expect(stats.n_users).toBe(1);
    expect(stats.dims.wifi?.sum).toBe(90);
    expect(stats.dims.wifi?.n).toBe(1);
    expect(stats.dims.outlets?.sum).toBe(85);
    expect(stats.dims.outlets?.n).toBe(1);
    expect(stats.dims.overall?.sum).toBe(85);
    expect(stats.dims.overall?.n).toBe(1);

    // The "A nomad" Promise: author is strictly null prior to explicit opt-in
    const detail = await getCafe(flagship.cafeId);
    expect(detail).not.toBeNull();
    const publicDetail = toPublicCafeDetail(detail!);
    expect(publicDetail.author).toBeNull();
  });

  // =========================================================================
  // Path 3: Profile & Identity Lifecycle
  // =========================================================================

  it("Path 3: profile read/write persists display name and resident city updates", async () => {
    const testUser = randomUUID();
    createdUserIds.add(testUser);
    await dbClient.query("insert into profiles (id, display_name, current_city) values ($1, $2, 'singapore')", [
      testUser,
      "Journey Ann",
    ]);

    const initial = await getProfile(testUser);
    expect(initial?.displayName).toBe("Journey Ann");

    const updated = await updateProfile(testUser, {
      displayName: "Nomad Explorer Ann",
      currentCity: "london",
    });
    expect(updated?.displayName).toBe("Nomad Explorer Ann");
    expect(updated?.currentCity).toBe("london");

    const readBack = await getProfile(testUser);
    expect(readBack?.displayName).toBe("Nomad Explorer Ann");
    expect(readBack?.currentCity).toBe("london");
  });

  it("Path 3: default anonymity guarantee holds across cafe detail and public check-in feed", async () => {
    const testCafe = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: `Anon Default Roasters ${randomUUID().slice(0, 8)}`,
      lat: 1.3065,
      lng: 103.8325,
      address: "10 Orchard Gate, Singapore",
      city: "singapore",
      checkin: {
        scores: { overall: 85 },
        max_stay: "unlimited",
        note: "Pre-consent anonymity verification",
        photo_ids: [],
      },
    });
    createdCafeIds.add(testCafe.cafeId);

    // Pre-consent: author must be null on both detail and check-in feed
    const cafeDetail = toPublicCafeDetail((await getCafe(testCafe.cafeId))!);
    expect(cafeDetail.author).toBeNull();

    const feed = await listPublicCheckIns({
      cafeId: testCafe.cafeId,
      mode: "newest",
      viewerId: null,
    });
    const firstCheckin = feed.checkins.find((c) => c.id === testCafe.checkinId);
    expect(firstCheckin).toBeDefined();
    expect(firstCheckin?.author).toBeNull();
  });

  it("Path 3: public identity toggle reveals name/avatar on opt-in and cleanly reverts to null on opt-out", async () => {
    // 1. Dedicated test user and cafe
    const testUser = randomUUID();
    createdUserIds.add(testUser);
    await dbClient.query("insert into profiles (id, display_name, current_city) values ($1, $2, 'singapore')", [
      testUser,
      "Nomad Explorer Ann",
    ]);

    const testCafe = await createCafeWithFirstCheckIn(testUser, {
      name: `Identity Toggle Roasters ${randomUUID().slice(0, 8)}`,
      lat: 1.3065,
      lng: 103.8325,
      address: "10 Orchard Gate, Singapore",
      city: "singapore",
      checkin: {
        scores: { overall: 85 },
        max_stay: "unlimited",
        note: "Public identity toggle test",
        photo_ids: [],
      },
    });
    createdCafeIds.add(testCafe.cafeId);

    // Assign avatar to profile
    const avatarUrl = "https://images.example.com/nomad-ann.webp";
    await dbClient.query("update profiles set avatar_url = $1 where id = $2", [
      avatarUrl,
      testUser,
    ]);

    // 2. Toggle public identity ON
    const optedIn = await updateProfileIdentity(testUser, {
      showPublicIdentity: true,
    });
    expect(optedIn.showPublicIdentity).toBe(true);
    expect(optedIn.publicHandle).toMatch(PUBLIC_HANDLE_REGEX);
    expect(optedIn.identityConsentedAt).not.toBeNull();

    // 3. Verify public projection reveals handle, display name and avatar
    const publicCafe = toPublicCafeDetail((await getCafe(testCafe.cafeId))!);
    expect(publicCafe.author).toEqual({
      handle: optedIn.publicHandle,
      display_name: "Nomad Explorer Ann",
      avatar_url: avatarUrl,
    });

    const publicFeed = await listPublicCheckIns({
      cafeId: testCafe.cafeId,
      mode: "newest",
      viewerId: null,
    });
    const publicCheckin = publicFeed.checkins.find((c) => c.id === testCafe.checkinId);
    expect(publicCheckin?.author).toEqual({
      handle: optedIn.publicHandle,
      display_name: "Nomad Explorer Ann",
      avatar_url: avatarUrl,
    });

    // 4. Toggle public identity OFF (lossless opt-out)
    const optedOut = await updateProfileIdentity(testUser, {
      showPublicIdentity: false,
    });
    expect(optedOut.showPublicIdentity).toBe(false);

    // 5. Verify immediate revert to author: null
    const anonCafe = toPublicCafeDetail((await getCafe(testCafe.cafeId))!);
    expect(anonCafe.author).toBeNull();

    const anonFeed = await listPublicCheckIns({
      cafeId: testCafe.cafeId,
      mode: "newest",
      viewerId: null,
    });
    const anonCheckin = anonFeed.checkins.find((c) => c.id === testCafe.checkinId);
    expect(anonCheckin?.author).toBeNull();

    // 6. Underlying profile data remains preserved and intact
    const profile = await getProfile(testUser);
    expect(profile?.displayName).toBe("Nomad Explorer Ann");
    expect(profile?.avatarUrl).toBe(avatarUrl);
    expect(profile?.publicHandle).toBe(optedIn.publicHandle);
  });
});
