/**
 * E2E backend user-journey matrix (spec 0007) — Paths 1→6 in one ordered
 * journey against real Postgres/PostGIS.
 *
 * Opt-in like the other integration suites:
 *   docker compose up -d --wait postgres
 *   RUN_INTEGRATION=1 npx vitest run tests/integration/user-journey.integration.test.ts
 *
 * Ordering note: the `it` blocks below are ONE journey and must run in
 * file order (vitest's default within a file). Seeding happens once in
 * `beforeAll`; there is intentionally no per-test reset so later paths
 * observe earlier paths' committed state — that accumulation IS the test.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CafeHasOtherCheckinsError,
  createCafeWithFirstCheckIn,
  deleteCafe,
  getCafe,
  listCafeSitemapEntries,
  listCafesNearby,
  toPublicCafeDetail,
} from "@/lib/db/cafes";
import {
  DuplicateCheckInError,
  SelfLikeError,
  createCheckIn,
  toggleCheckInLike,
  updateCheckIn,
} from "@/lib/db/checkins";
import { updateProfileIdentity } from "@/lib/db/identity";
import { getProfile, updateProfile } from "@/lib/db/profile";
import { searchCafesInDb } from "@/lib/db/search";
import { listPublicCheckIns } from "@/lib/discovery/feed";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
} from "@/lib/images/complete";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
  testDatabaseUrl,
} from "../helpers/db";
import { cafeWorkStats, fakeProcessUrls } from "../helpers/fixtures";
import {
  JOURNEY_U1,
  JOURNEY_U2,
  JOURNEY_U3,
  MOCK_CAFES,
  seedMockDataset,
} from "../fixtures/mock-dataset";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeJourney = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_journey");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

// Journey state shared across ordered paths.
let journeyCafeId = "";
let journeyCreationCheckinId = "";
let visitorCheckinId = "";

function imageStubDeps() {
  return {
    ...defaultCompleteUploadDeps(),
    getProcessUrls: async ({ imageUuid }: { imageUuid: string }) =>
      fakeProcessUrls(imageUuid),
    processImage: async (imageUuid: string) => ({
      imageUuid,
      publicUrls: fakeProcessUrls(imageUuid).publicUrls,
      width: 800,
      height: 600,
    }),
  };
}

describeJourney("journey — multi-user backend user paths 1→6 (spec 0007)", () => {
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
      throw new AggregateError(errors, "journey integration cleanup failed");
    }
  });

  it("Path 1: nearby map load returns Singapore cafes closest-first, excludes Tokyo", async () => {
    const nearby = await listCafesNearby({
      lat: 1.3048,
      lng: 103.8318,
      radiusKm: 10,
      limit: 20,
    });
    const names = nearby.map((c) => c.name);
    expect(names).toContain("Orchard Nomad Roasters");
    expect(names).toContain("Bugis Outlet Haven");
    expect(names).not.toContain("Shibuya Deep Work Coffee");
    // Closest-first: the query point is exactly Orchard's coordinates.
    expect(nearby[0]?.name).toBe("Orchard Nomad Roasters");
    for (let i = 1; i < nearby.length; i += 1) {
      expect(nearby[i - 1]?.distance_m).toBeLessThanOrEqual(
        nearby[i]?.distance_m ?? Number.POSITIVE_INFINITY,
      );
    }
  });

  it("Path 1: city + keyword search scopes to Tokyo, nomad wifi filter narrows", async () => {
    const tokyo = await searchCafesInDb({ city: "tokyo", limit: 20 });
    expect(tokyo).toHaveLength(2);
    expect(tokyo.map((c) => c.city).every((c) => c === "tokyo")).toBe(true);

    const keyword = await searchCafesInDb({ q: "Shibuya", limit: 20 });
    expect(keyword.map((c) => c.name)).toContain("Shibuya Deep Work Coffee");

    // Dimension filters need work_stats: probe two SG cafes with opposing wifi.
    const [sgHigh, sgLow] = [MOCK_CAFES[1]!.id, MOCK_CAFES[2]!.id];
    await createCheckIn(JOURNEY_U1, { cafe_id: sgHigh, scores: { wifi: 95 } });
    await createCheckIn(JOURNEY_U2, { cafe_id: sgLow, scores: { wifi: 20 } });
    const filtered = await searchCafesInDb({
      city: "singapore",
      filter_wifi: 80,
      limit: 20,
    });
    const filteredIds = filtered.map((c) => c.id);
    expect(filteredIds).toContain(sgHigh);
    expect(filteredIds).not.toContain(sgLow);
  });

  it("Path 2: fused cafe creation writes geo point, tz, first check-in, and work_stats", async () => {
    const created = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: "Journey Flagship",
      lat: 1.3065,
      lng: 103.8325,
      address: "2 Orchard Rd, Singapore",
      city: "singapore",
      checkin: {
        scores: { overall: 82, wifi: 90, outlets: 85 },
        max_stay: "unlimited",
        note: "flagship first impression",
        photo_ids: [],
      },
    });
    journeyCafeId = created.cafeId;
    journeyCreationCheckinId = created.checkinId;
    expect(created.tz).toBe("Asia/Singapore");

    const stored = await dbClient.query(
      "select ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, city, tz from cafes where id = $1",
      [journeyCafeId],
    );
    expect(stored.rows[0].lat).toBeCloseTo(1.3065, 4);
    expect(stored.rows[0].city).toBe("singapore");

    const stats = await cafeWorkStats(dbClient, journeyCafeId);
    expect(stats.n_checkins).toBe(1);
    expect(stats.n_users).toBe(1);

    // The "A nomad" promise: anonymous by default.
    const detail = await getCafe(journeyCafeId);
    expect(detail).not.toBeNull();
    expect(toPublicCafeDetail(detail!).author).toBeNull();
  });

  it("Path 2: photo pipeline mounts a completed upload into the cafe gallery", async () => {
    const photoId = randomUUID();
    await recordUploadIntent(JOURNEY_U1, photoId);
    const result = await completeImageUpload(
      { id: JOURNEY_U1 },
      { imageUuid: photoId, targetType: "cafe", targetId: journeyCafeId, isCover: false },
      imageStubDeps(),
    );
    expect(result.ok).toBe(true);

    const gallery = await dbClient.query(
      "select gallery from cafes where id = $1",
      [journeyCafeId],
    );
    const images = gallery.rows[0].gallery as Array<Record<string, unknown>>;
    expect(images.some((p) => p.id === photoId)).toBe(true);
  });

  it("Path 3: profile edit persists; identity opt-in projects author, opt-out restores null", async () => {
    const updated = await updateProfile(JOURNEY_U1, {
      displayName: "Journey Ann",
      currentCity: "tokyo",
    });
    expect(updated?.displayName).toBe("Journey Ann");
    expect((await getProfile(JOURNEY_U1))?.currentCity).toBe("tokyo");

    const optedIn = await updateProfileIdentity(JOURNEY_U1, {
      showPublicIdentity: true,
    });
    expect(optedIn.showPublicIdentity).toBe(true);
    expect(optedIn.publicHandle).toMatch(/^[a-z0-9][a-z0-9_-]{2,29}$/);

    const publicDetail = toPublicCafeDetail((await getCafe(journeyCafeId))!);
    expect(publicDetail.author?.display_name).toBe("Journey Ann");
    const feed = await listPublicCheckIns({
      cafeId: journeyCafeId,
      mode: "newest",
      viewerId: null,
    });
    expect(
      feed.checkins.find((c) => c.id === journeyCreationCheckinId)?.author,
    ).not.toBeNull();

    await updateProfileIdentity(JOURNEY_U1, { showPublicIdentity: false });
    expect(toPublicCafeDetail((await getCafe(journeyCafeId))!).author).toBeNull();
    const anonFeed = await listPublicCheckIns({
      cafeId: journeyCafeId,
      mode: "newest",
      viewerId: null,
    });
    expect(
      anonFeed.checkins.find((c) => c.id === journeyCreationCheckinId)?.author,
    ).toBeNull();
  });

  it("Path 4: visitor check-in recomputes aggregates; DG64 revisit becomes an edit", async () => {
    const second = await createCheckIn(JOURNEY_U2, {
      cafe_id: journeyCafeId,
      scores: { overall: 70, wifi: 75 },
      note: "visitor perspective",
    });
    visitorCheckinId = second.checkinId;

    const stats = await cafeWorkStats(dbClient, journeyCafeId);
    expect(stats.n_checkins).toBe(2);
    expect(stats.n_users).toBe(2);

    // Same-window revisit: no second row — the live id is returned for edit.
    const err = await createCheckIn(JOURNEY_U2, {
      cafe_id: journeyCafeId,
      scores: { overall: 90 },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateCheckInError);
    expect((err as DuplicateCheckInError).existingCheckinId).toBe(visitorCheckinId);

    await updateCheckIn(JOURNEY_U2, visitorCheckinId, {
      scores: { overall: 90 },
      note: "revisited and revised",
    });
    const edited = await dbClient.query(
      "select note, scores from checkins where id = $1",
      [visitorCheckinId],
    );
    expect(edited.rows[0].note).toBe("revisited and revised");
    const liveCount = await dbClient.query(
      "select count(*)::int as n from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
      [journeyCafeId, JOURNEY_U2],
    );
    expect(liveCount.rows[0].n).toBe(1);
  });

  it("Path 4: DG61 idempotency key replays to the same check-in without a duplicate row", async () => {
    const londonCafe = MOCK_CAFES[5]!.id;
    const key = randomUUID();
    const first = await createCheckIn(JOURNEY_U2, {
      cafe_id: londonCafe,
      scores: { overall: 60 },
      idempotency_key: key,
    });
    expect(first.deduped).toBe(false);

    const replay = await createCheckIn(JOURNEY_U2, {
      cafe_id: londonCafe,
      scores: { overall: 60 },
      idempotency_key: key,
    });
    expect(replay.checkinId).toBe(first.checkinId);
    expect(replay.deduped).toBe(true);

    const rows = await dbClient.query(
      "select count(*)::int as n from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
      [londonCafe, JOURNEY_U2],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("Path 4: feed exposes newest-first and helpful orderings with keyset cursors", async () => {
    const newest = await listPublicCheckIns({
      cafeId: journeyCafeId,
      mode: "newest",
      viewerId: null,
    });
    expect(newest.checkins).toHaveLength(2);
    const visited = newest.checkins.map((c) => c.visited_at);
    expect(new Date(visited[0]!).getTime()).toBeGreaterThanOrEqual(
      new Date(visited[1]!).getTime(),
    );

    // Helpful ordering is proven after Path 5 adds a like; here assert
    // the page contract (cursor field present, no viewer leakage).
    expect(newest.nextCursor === null || typeof newest.nextCursor === "string").toBe(true);
  });

  it("Path 5: like/unlike toggles atomically; self-like is rejected (DG08)", async () => {
    const liked = await toggleCheckInLike(JOURNEY_U2, journeyCreationCheckinId);
    expect(liked).toEqual({ liked: true, likesCount: 1 });

    const helpful = await listPublicCheckIns({
      cafeId: journeyCafeId,
      mode: "helpful",
      viewerId: null,
    });
    expect(helpful.checkins[0]?.id).toBe(journeyCreationCheckinId);

    const unliked = await toggleCheckInLike(JOURNEY_U2, journeyCreationCheckinId);
    expect(unliked).toEqual({ liked: false, likesCount: 0 });

    await expect(
      toggleCheckInLike(JOURNEY_U1, journeyCreationCheckinId),
    ).rejects.toBeInstanceOf(SelfLikeError);
  });

  it("Path 6: solo cafe deletes to a shell and leaves sitemap/retrieval", async () => {
    const solo = await createCafeWithFirstCheckIn(JOURNEY_U3, {
      name: "Solo Pop-up",
      lat: 35.6595,
      lng: 139.7005,
      city: "tokyo",
      checkin: {
        scores: { overall: 75 },
        max_stay: "2h",
        note: "only me",
        photo_ids: [],
      },
    });
    const result = await deleteCafe(solo.cafeId, JOURNEY_U3);
    expect(result).toEqual({
      ok: true,
      id: solo.cafeId,
      removed_checkins: 1,
      owner_transferred: false,
      shell: true,
    });
    const sitemapIds = (await listCafeSitemapEntries()).map((e) => e.id);
    expect(sitemapIds).not.toContain(solo.cafeId);
  });

  it("Path 6: community cafe requires confirm, then hands off to the service account", async () => {
    const err = await deleteCafe(journeyCafeId, JOURNEY_U1).catch((e) => e);
    expect(err).toBeInstanceOf(CafeHasOtherCheckinsError);

    const result = await deleteCafe(journeyCafeId, JOURNEY_U1, { confirm: true });
    expect(result.owner_transferred).toBe(true);

    const owner = await dbClient.query(
      "select created_by from cafes where id = $1",
      [journeyCafeId],
    );
    expect(owner.rows[0].created_by).toBe("00000000-0000-4000-a000-000000000001");
    // Service-account托管永远匿名 (spec 0006 correction 2).
    expect(toPublicCafeDetail((await getCafe(journeyCafeId))!).author).toBeNull();
  });
});
