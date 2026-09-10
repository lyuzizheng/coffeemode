/**
 * E2E backend user-journey matrix (spec 0007) — Paths 4→6: social dynamics
 * and cafe lifecycle (BRAWUKA-144, Stage 2 of 3).
 *
 * Self-contained: provisions its own database, seeds the shared mock
 * dataset, and builds its own journey cafes — no shared state with the
 * discovery/creation suite. Service-layer scope per spec 0007 §1: calls
 * `web/lib/db/*` and `web/lib/discovery/feed.ts` directly against real
 * Postgres/PostGIS. Runs under the real-DB gate only (`RUN_INTEGRATION=1`).
 *
 * - Path 4: multi-user check-in dynamics — weighted aggregate recompute,
 *   DG64 same-window revisit → edit mode, DG64 cross-24h → new record,
 *   DG61 idempotency replay, feed newest/helpful ordering + keyset cursors.
 * - Path 5: like/unlike atomic toggle (DG08), self-like rejected at the
 *   service layer AND the 0008 DB trigger backstop.
 * - Path 6: solo cafe → tombstone shell (repeat POI import blocked via
 *   `CafeExistsError`, sitemap drop); community cafe → bare delete blocked,
 *   confirmed delete hands ownership to the service account and removes
 *   only the caller's check-ins (DG125).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CafeExistsError,
  CafeHasOtherCheckinsError,
  createCafeWithFirstCheckIn,
  deleteCafe,
  getCafe,
  listCafeSitemapEntries,
  toPublicCafeDetail,
} from "@/lib/db/cafes";
import {
  CafeNotFoundError,
  DuplicateCheckInError,
  SelfLikeError,
  createCheckIn,
  toggleCheckInLike,
  updateCheckIn,
} from "@/lib/db/checkins";
import { listPublicCheckIns } from "@/lib/discovery/feed";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import { cafeWorkStats } from "../helpers/fixtures";
import {
  JOURNEY_SERVICE_ACCOUNT_ID,
  JOURNEY_U1,
  JOURNEY_U2,
  JOURNEY_U3,
  MOCK_CAFES,
  seedMockDataset,
} from "../fixtures/mock-dataset";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeSocial = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_social");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

// Journey state shared across the ordered paths.
let socialCafeId = "";
let creationCheckinId = "";
let visitorCheckinId = "";
let revisitCheckinId = "";
let feedCafeId = "";
let feedCreationCheckinId = "";
let oldestFeedCheckinId = "";
let soloCafeId = "";

const TOMBSTONE_PLACE_ID = "ChIJ_journey_solo_tombstone_01";

describeSocial("journey — social & lifecycle paths 4→6 (spec 0007)", () => {
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
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (error) {
        errors.push(error);
      }
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (errors.length > 0) {
      throw new AggregateError(errors, "social-lifecycle integration cleanup failed");
    }
  }, 60_000);

  it("Path 4: visitor check-in recomputes the weighted aggregate (n 1→2, mean tracks both users)", async () => {
    const created = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: "Social Dynamics House",
      lat: 1.3065,
      lng: 103.8325,
      address: "2 Orchard Rd, Singapore",
      city: "singapore",
      checkin: {
        scores: { overall: 90, wifi: 88 },
        max_stay: "unlimited",
        note: "creator first impression",
        photo_ids: [],
      },
    });
    socialCafeId = created.cafeId;
    creationCheckinId = created.checkinId;

    const afterCreate = await cafeWorkStats(dbClient, socialCafeId);
    expect(afterCreate.n_checkins).toBe(1);
    expect(afterCreate.n_users).toBe(1);
    expect(afterCreate.experience_score).toBe(90);

    const second = await createCheckIn(JOURNEY_U2, {
      cafe_id: socialCafeId,
      scores: { overall: 50, wifi: 60 },
      note: "visitor perspective",
    });
    visitorCheckinId = second.checkinId;
    expect(second.deduped).toBe(false);

    // One check-in per user: each contribution carries weight 1, so the
    // persisted aggregate is the exact two-user mean.
    const stats = await cafeWorkStats(dbClient, socialCafeId);
    expect(stats.n_checkins).toBe(2);
    expect(stats.n_users).toBe(2);
    expect(stats.dims.overall).toMatchObject({ sum: 140, n: 2 });
    expect(stats.experience_score).toBe(70);
  });

  it("Path 4: DG64 same-window revisit throws DuplicateCheckInError and converts to an edit", async () => {
    const err = await createCheckIn(JOURNEY_U2, {
      cafe_id: socialCafeId,
      scores: { overall: 95 },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicateCheckInError);
    expect((err as DuplicateCheckInError).existingCheckinId).toBe(visitorCheckinId);

    await updateCheckIn(JOURNEY_U2, visitorCheckinId, {
      scores: { overall: 60 },
      note: "revisited and revised",
    });
    const edited = await dbClient.query(
      "select note, scores from checkins where id = $1",
      [visitorCheckinId],
    );
    expect(edited.rows[0].note).toBe("revisited and revised");
    expect(edited.rows[0].scores.overall).toBe(60);
    const liveCount = await dbClient.query(
      "select count(*)::int as n from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
      [socialCafeId, JOURNEY_U2],
    );
    expect(liveCount.rows[0].n).toBe(1);
  });

  it("Path 4: DG64 cross-24h revisit creates a new record instead of editing", async () => {
    await dbClient.query(
      "update checkins set visited_at = now() - interval '25 hours', updated_at = now() where id = $1",
      [visitorCheckinId],
    );

    const revisit = await createCheckIn(JOURNEY_U2, {
      cafe_id: socialCafeId,
      scores: { overall: 80 },
      note: "back the next day",
    });
    revisitCheckinId = revisit.checkinId;
    expect(revisitCheckinId).not.toBe(visitorCheckinId);
    expect(revisit.deduped).toBe(false);

    const live = await dbClient.query<{ id: string }>(
      "select id from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null order by visited_at asc",
      [socialCafeId, JOURNEY_U2],
    );
    expect(live.rows.map((r) => r.id)).toEqual([visitorCheckinId, revisitCheckinId]);

    const stats = await cafeWorkStats(dbClient, socialCafeId);
    expect(stats.n_checkins).toBe(3);
    expect(stats.n_users).toBe(2);
  });

  it("Path 4: DG61 idempotency key replays to the same check-in without a duplicate row", async () => {
    const londonCafe = MOCK_CAFES[5]!.id;
    const key = randomUUID();
    const first = await createCheckIn(JOURNEY_U3, {
      cafe_id: londonCafe,
      scores: { overall: 60 },
      note: "first attempt",
      idempotency_key: key,
    });
    expect(first.deduped).toBe(false);

    const replay = await createCheckIn(JOURNEY_U3, {
      cafe_id: londonCafe,
      scores: { overall: 10 },
      note: "retried with different payload",
      idempotency_key: key,
    });
    expect(replay.checkinId).toBe(first.checkinId);
    expect(replay.deduped).toBe(true);

    const rows = await dbClient.query(
      "select count(*)::int as n, max(note) as note from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
      [londonCafe, JOURNEY_U3],
    );
    expect(rows.rows[0].n).toBe(1);
    // The replay returns the original id; the first payload wins.
    expect(rows.rows[0].note).toBe("first attempt");
  });

  it("Path 4: feed exposes newest-first and helpful orderings with keyset cursors", async () => {
    const created = await createCafeWithFirstCheckIn(JOURNEY_U1, {
      name: "Feed Pagination House",
      lat: 1.3075,
      lng: 103.8335,
      address: "3 Orchard Rd, Singapore",
      city: "singapore",
      checkin: {
        scores: { overall: 80 },
        max_stay: "unlimited",
        note: "feed anchor",
        photo_ids: [],
      },
    });
    feedCafeId = created.cafeId;
    feedCreationCheckinId = created.checkinId;

    // 21 further visitors, each with one staggered backdated visit (>24h
    // old, so DG64 never trips) for a deterministic newest order.
    const visitorIds: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const id = randomUUID();
      visitorIds.push(id);
      await dbClient.query(
        "insert into profiles (id, display_name, current_city) values ($1, $2, 'singapore') on conflict (id) do nothing",
        [id, `Feed${i}`],
      );
      const visitedAt = new Date(Date.now() - (48 + i * 3) * 3_600_000);
      const res = await createCheckIn(id, {
        cafe_id: feedCafeId,
        scores: { overall: 70 },
        note: `feed visit ${i}`,
        visited_at: visitedAt,
      });
      if (i === 20) oldestFeedCheckinId = res.checkinId;
    }

    // Newest: the live creation check-in (visited_at now) leads; 22 rows
    // paginate 20 + 2 across the pageSize boundary.
    const page1 = await listPublicCheckIns({
      cafeId: feedCafeId,
      mode: "newest",
      viewerId: null,
    });
    expect(page1.checkins).toHaveLength(20);
    expect(page1.checkins[0]?.id).toBe(feedCreationCheckinId);
    expect(typeof page1.nextCursor).toBe("string");

    const page2 = await listPublicCheckIns({
      cafeId: feedCafeId,
      mode: "newest",
      cursor: page1.nextCursor!,
      viewerId: null,
    });
    expect(page2.checkins).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const page1Ids = new Set(page1.checkins.map((c) => c.id));
    expect(page2.checkins.every((c) => !page1Ids.has(c.id))).toBe(true);
    const allCheckins = [...page1.checkins, ...page2.checkins];
    for (let i = 1; i < allCheckins.length; i += 1) {
      expect(new Date(allCheckins[i]!.visited_at).getTime()).toBeLessThanOrEqual(
        new Date(allCheckins[i - 1]!.visited_at).getTime(),
      );
    }

    // Helpful: two likes lift the oldest check-in above every unliked row.
    await toggleCheckInLike(JOURNEY_U1, oldestFeedCheckinId);
    await toggleCheckInLike(JOURNEY_U3, oldestFeedCheckinId);
    const helpful = await listPublicCheckIns({
      cafeId: feedCafeId,
      mode: "helpful",
      viewerId: null,
    });
    expect(helpful.checkins[0]?.id).toBe(oldestFeedCheckinId);
    expect(helpful.checkins[0]?.likes_count).toBe(2);
  });

  it("Path 5: like/unlike toggles atomically with symmetric counters (DG08)", async () => {
    const liked = await toggleCheckInLike(JOURNEY_U2, creationCheckinId);
    expect(liked).toEqual({ liked: true, likesCount: 1 });

    const stored = await dbClient.query(
      "select likes_count from checkins where id = $1",
      [creationCheckinId],
    );
    expect(stored.rows[0].likes_count).toBe(1);
    const likeRows = await dbClient.query(
      "select count(*)::int as n from checkin_likes where checkin_id = $1 and user_id = $2",
      [creationCheckinId, JOURNEY_U2],
    );
    expect(likeRows.rows[0].n).toBe(1);

    const unliked = await toggleCheckInLike(JOURNEY_U2, creationCheckinId);
    expect(unliked).toEqual({ liked: false, likesCount: 0 });
    const afterUnlike = await dbClient.query(
      "select likes_count from checkins where id = $1",
      [creationCheckinId],
    );
    expect(afterUnlike.rows[0].likes_count).toBe(0);
  });

  it("Path 5: self-like is rejected by the service guard and the 0008 DB trigger backstop", async () => {
    await expect(
      toggleCheckInLike(JOURNEY_U1, creationCheckinId),
    ).rejects.toBeInstanceOf(SelfLikeError);

    // A writer bypassing the lib still hits the BEFORE INSERT trigger.
    const direct = await dbClient
      .query("insert into checkin_likes (user_id, checkin_id) values ($1, $2)", [
        JOURNEY_U1,
        creationCheckinId,
      ])
      .then(
        () => "inserted",
        (e: Error) => e.message,
      );
    expect(direct).toMatch(/self-like/i);

    const counts = await dbClient.query(
      "select likes_count from checkins where id = $1",
      [creationCheckinId],
    );
    expect(counts.rows[0].likes_count).toBe(0);
  });

  it("Path 6: solo cafe deletes to a tombstone shell that blocks repeat POI import and leaves the sitemap", async () => {
    const solo = await createCafeWithFirstCheckIn(JOURNEY_U3, {
      name: "Solo Tombstone Pop-up",
      lat: 35.6595,
      lng: 139.7005,
      city: "tokyo",
      google_place_id: TOMBSTONE_PLACE_ID,
      checkin: {
        scores: { overall: 75 },
        max_stay: "2h",
        note: "only me",
        photo_ids: [],
      },
    });
    soloCafeId = solo.cafeId;

    const result = await deleteCafe(soloCafeId, JOURNEY_U3);
    expect(result).toEqual({
      ok: true,
      id: soloCafeId,
      removed_checkins: 1,
      owner_transferred: false,
      shell: true,
    });

    // The row survives as a shell: live, external id retained, own
    // check-in soft-deleted.
    const shell = await dbClient.query(
      "select deleted_at, google_place_id from cafes where id = $1",
      [soloCafeId],
    );
    expect(shell.rows[0].deleted_at).toBeNull();
    expect(shell.rows[0].google_place_id).toBe(TOMBSTONE_PLACE_ID);
    const ownLive = await dbClient.query(
      "select count(*)::int as n from checkins where cafe_id = $1 and deleted_at is null",
      [soloCafeId],
    );
    expect(ownLive.rows[0].n).toBe(0);

    // Repeat POI import with the same external id is blocked.
    const dup = await createCafeWithFirstCheckIn(JOURNEY_U3, {
      name: "Solo Tombstone Pop-up",
      lat: 35.6595,
      lng: 139.7005,
      city: "tokyo",
      google_place_id: TOMBSTONE_PLACE_ID,
      checkin: { scores: { overall: 70 }, max_stay: "2h", note: "retry", photo_ids: [] },
    }).catch((e) => e);
    expect(dup).toBeInstanceOf(CafeExistsError);
    expect((dup as CafeExistsError).existingCafeId).toBe(soloCafeId);

    const sitemapIds = (await listCafeSitemapEntries()).map((e) => e.id);
    expect(sitemapIds).not.toContain(soloCafeId);

    // Repeat delete on the emptied shell: nothing left to delete.
    await expect(deleteCafe(soloCafeId, JOURNEY_U3)).rejects.toBeInstanceOf(
      CafeNotFoundError,
    );
  });

  it("Path 6: community cafe requires confirm, then hands off to the service account keeping other check-ins (DG125)", async () => {
    const err = await deleteCafe(socialCafeId, JOURNEY_U1).catch((e) => e);
    expect(err).toBeInstanceOf(CafeHasOtherCheckinsError);
    expect((err as CafeHasOtherCheckinsError).n).toBe(2);

    const result = await deleteCafe(socialCafeId, JOURNEY_U1, { confirm: true });
    expect(result.owner_transferred).toBe(true);
    expect(result.shell).toBe(false);
    expect(result.removed_checkins).toBe(1);

    const owner = await dbClient.query(
      "select created_by from cafes where id = $1",
      [socialCafeId],
    );
    expect(owner.rows[0].created_by).toBe(JOURNEY_SERVICE_ACCOUNT_ID);

    // Only the caller's check-ins were removed; the visitor's two live on.
    const remaining = await dbClient.query(
      "select user_id, count(*)::int as n from checkins where cafe_id = $1 and deleted_at is null group by user_id",
      [socialCafeId],
    );
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0].user_id).toBe(JOURNEY_U2);
    expect(remaining.rows[0].n).toBe(2);

    const stats = await cafeWorkStats(dbClient, socialCafeId);
    expect(stats.n_checkins).toBe(2);
    expect(stats.n_users).toBe(1);

    // Service-account托管永远匿名 (spec 0006 correction 2).
    expect(toPublicCafeDetail((await getCafe(socialCafeId))!).author).toBeNull();
  });
});
