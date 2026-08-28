/**
 * Real-Postgres integration suite — the answer to "SQL by reasoning only".
 *
 * Requires a running local Postgres (docker-compose.yml) and is opt-in:
 *
 *   docker compose up -d --wait postgres # postgis/postgis on :5432
 *   npm run test:integration        # = RUN_INTEGRATION=1 vitest run ...
 *
 * What this verifies that unit tests cannot:
 *   - migrations 0001→0008 apply cleanly against real Postgres + PostGIS;
 *   - the 0008 no-self-like BEFORE INSERT trigger actually rejects;
 *   - the 0004 likes_count sync trigger fires on direct/cascade writes;
 *   - toggleCheckInLike's CTE semantics (like/unlike/self-like/legacy un-like);
 *   - the fused cafe+checkin transaction and work_stats on a real DB;
 *   - recordNavigation's 404/insert behavior.
 *
 * Without RUN_INTEGRATION=1 every spec here is skipped, so `npm test`
 * (plain unit suite) stays green on machines without Docker.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CafeNotFoundError,
  CheckInForbiddenError,
  CheckInNotFoundError,
  MERGE_GALLERY_SQL,
  SelfLikeError,
  createCheckIn,
  softDeleteCheckIn,
  toggleCheckInLike,
  updateCheckIn,
} from "@/lib/db/checkins";
import {
  CafeExistsError,
  createCafeWithFirstCheckIn,
  getCafe,
  getCafeLocation,
  listCafeSitemapEntries,
  listCafesNearby,
  reviveCafe,
  softDeleteCafe,
} from "@/lib/db/cafes";
import {
  getProfile,
  getUserStats,
  updateProfile,
  getUserCheckIns,
  getUserCafes,
} from "@/lib/db/profile";
import { searchCafesInDb } from "@/lib/db/search";
import { recordNavigation } from "@/lib/db/navigations";
import {
  FeedCursorError,
  encodeFeedCursor,
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
} from "@/lib/images/complete";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { recomputeAllWorkStats } from "@/lib/stats/aggregate";
import { coerceWorkStats } from "@/lib/stats/work-stats";
import {
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
  runMigrations,
  testDatabaseUrl,
} from "../helpers/db";
import {
  CAFE_A,
  CHECKIN_A1,
  U1,
  U2,
  cafeWorkStats,
  fakeProcessUrls,
  fakeProvisionPhotosDeps,
  seedBaseData,
} from "../helpers/fixtures";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeDb = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_test");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client; // raw seeding connection (independent of the app pool)
const previousDatabaseUrl = process.env.DATABASE_URL;

describeDb("integration — real Postgres/PostGIS (docker compose up -d --wait postgres)", () => {
  beforeAll(async () => {
    // Capture the ADMIN (maintenance DB) URL BEFORE mutating DATABASE_URL —
    // afterAll must connect to the maintenance DB to drop the test DB, not to
    // the test database itself ("cannot drop the currently open database").
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    runMigrations(testDbUrl);
    // Point the app's shared pool at the test DB before any lib call.
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
  }, 120_000);

  // Hard isolation: reset all rows that can be mutated by a test, then seed
  // the same baseline. Tests do not depend on declaration order.
  beforeEach(async () => {
    // A legacy self-like test temporarily disables this trigger; re-enable it
    // before truncation so the table state is deterministic.
    await dbClient.query("alter table checkin_likes enable trigger all");
    await dbClient.query(
      "truncate table profiles, cafes, rate_limits, image_upload_intents, navigations restart identity cascade",
    );
    await seedBaseData(dbClient);
  });

  it("rejects a local-looking URL with a remote effective host override", () => {
    const original = process.env.DATABASE_URL;
    const originalOptIn = process.env.ALLOW_REMOTE_INTEGRATION_DB;
    process.env.DATABASE_URL =
      "postgres://coffeemode:coffeemode@localhost:5432/coffeemode?host=remote.example";
    delete process.env.ALLOW_REMOTE_INTEGRATION_DB;
    try {
      expect(() => integrationAdminUrl()).toThrow(/overridden host/);
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
      if (originalOptIn === undefined) delete process.env.ALLOW_REMOTE_INTEGRATION_DB;
      else process.env.ALLOW_REMOTE_INTEGRATION_DB = originalOptIn;
    }
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
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "real-DB integration cleanup failed");
    }
  });

  it("applies migrations 0001→0012 and installs PostGIS + both triggers", async () => {
    const { rows } = await dbClient.query("select name from schema_migrations order by name");
    expect(rows.map((r) => r.name)).toEqual([
      "0001_init.sql",
      "0002_checkins_and_indexes.sql",
      "0003_rate_limits.sql",
      "0004_checkin_likes_trigger.sql",
      "0005_cafe_timezone.sql",
      "0006_image_upload_intents.sql",
      "0007_checkins_spec_alignment.sql",
      "0008_no_self_likes.sql",
      "0009_cafe_tombstones.sql",
      "0010_drop_min_spend.sql",
      "0011_cafe_tombstone_lifecycle.sql",
      "0012_drop_redundant_cafe_indexes.sql",
    ]);

    const pgVersion = await dbClient.query("select postgis_version() as v");
    expect(pgVersion.rows[0].v).toMatch(/^3\./);

    const triggers = await dbClient.query(
      `select tgname from pg_trigger
       where tgrelid = 'checkin_likes'::regclass and not tgisinternal
       order by tgname`,
    );
    expect(triggers.rows.map((r) => r.tgname)).toEqual([
      "trg_checkin_likes_no_self",
      "trg_checkin_likes_sync",
    ]);
  });

  describeDb("toggleCheckInLike on real SQL", () => {
    it("likes and unlikes another user's check-in, keeping likes_count in sync", async () => {
      const liked = await toggleCheckInLike(U2, CHECKIN_A1);
      expect(liked).toEqual({ liked: true, likesCount: 1 });

      const { rows } = await dbClient.query(
        "select likes_count from checkins where id = $1",
        [CHECKIN_A1],
      );
      expect(rows[0].likes_count).toBe(1);

      const unliked = await toggleCheckInLike(U2, CHECKIN_A1);
      expect(unliked).toEqual({ liked: false, likesCount: 0 });
    });

    it("rejects a self-like with SelfLikeError and writes nothing", async () => {
      await expect(toggleCheckInLike(U1, CHECKIN_A1)).rejects.toBeInstanceOf(SelfLikeError);

      const { rows } = await dbClient.query(
        "select count(*)::int as n from checkin_likes where checkin_id = $1",
        [CHECKIN_A1],
      );
      expect(rows[0].n).toBe(0);

      const counter = await dbClient.query(
        "select likes_count from checkins where id = $1",
        [CHECKIN_A1],
      );
      expect(counter.rows[0].likes_count).toBe(0);
    });

    it("throws CheckInNotFoundError for a missing or soft-deleted check-in", async () => {
      await expect(
        toggleCheckInLike(U2, "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a00"),
      ).rejects.toBeInstanceOf(CheckInNotFoundError);

      await dbClient.query("update checkins set deleted_at = now() where id = $1", [CHECKIN_A1]);
      await expect(toggleCheckInLike(U2, CHECKIN_A1)).rejects.toBeInstanceOf(CheckInNotFoundError);
    });
  });

  describeDb("checkin_likes DB invariants", () => {
    it("0008 BEFORE INSERT trigger rejects a direct self-like from any writer", async () => {
      await expect(
        dbClient.query(
          "insert into checkin_likes (user_id, checkin_id) values ($1, $2)",
          [U1, CHECKIN_A1],
        ),
      ).rejects.toThrow(/self-likes are not allowed/);
    });

    it("legacy self-like rows (pre-0008) can still be un-liked via the toggle", async () => {
      // Simulate a row written before migration 0008 existed.
      await dbClient.query("alter table checkin_likes disable trigger trg_checkin_likes_no_self");
      try {
        await dbClient.query(
          "insert into checkin_likes (user_id, checkin_id) values ($1, $2)",
          [U1, CHECKIN_A1],
        );
      } finally {
        await dbClient.query("alter table checkin_likes enable trigger trg_checkin_likes_no_self");
      }

      const legacy = await toggleCheckInLike(U1, CHECKIN_A1);
      expect(legacy).toEqual({ liked: false, likesCount: 0 });

      const { rows } = await dbClient.query(
        "select count(*)::int as n from checkin_likes where checkin_id = $1",
        [CHECKIN_A1],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describeDb("write paths on real SQL", () => {
    it("createCheckIn folds the new check-in into work_stats (recompute)", async () => {
      const result = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 60 } });
      expect(result.checkinId).toMatch(/^[0-9a-f-]{36}$/);

      const stats = await cafeWorkStats(dbClient, CAFE_A);
      expect(stats.n_users).toBe(2);
      expect(stats.n_checkins).toBe(2);
      expect(stats.dims.overall).toEqual({ sum: 60, n: 1 });
      expect(stats.experience_score).toBe(60);
    });

    it("createCafeWithFirstCheckIn fuses cafe + first check-in + stats and dedupes", async () => {
      const photoId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66";
      await recordUploadIntent(U1, photoId);
      const created = await createCafeWithFirstCheckIn(U1, {
        name: "New Cafe",
        lat: 1.35,
        lng: 103.8,
        city: "singapore",
        google_place_id: "ChIJ-test-1",
        checkin: {
          scores: { overall: 82 },
          max_stay: "unlimited",
          note: "nice",
          photo_ids: [photoId],
        },
      }, fakeProvisionPhotosDeps());
      expect(created.tz).toBe("Asia/Singapore");

      const storedCheckIn = await dbClient.query(
        "select is_creation, photos from checkins where id = $1",
        [created.checkinId],
      );
      expect(storedCheckIn.rows[0].is_creation).toBe(true);
      expect(storedCheckIn.rows[0].photos).toEqual([
        expect.objectContaining({
          id: photoId,
          original: expect.any(String),
          card: expect.any(String),
          thumbnail: expect.any(String),
          w: 800,
          h: 600,
          by: U1,
          at: expect.any(String),
          source: { type: "checkin", id: created.checkinId },
        }),
      ]);

      const storedGallery = await dbClient.query("select gallery from cafes where id = $1", [
        created.cafeId,
      ]);
      expect(storedGallery.rows[0].gallery).toEqual([
        expect.objectContaining({
          id: photoId,
          original: expect.any(String),
          card: expect.any(String),
          thumbnail: expect.any(String),
          w: 800,
          h: 600,
          by: U1,
          at: expect.any(String),
          source: { type: "checkin", id: created.checkinId },
        }),
      ]);
      const consumedIntent = await dbClient.query(
        "select image_uuid from image_upload_intents where image_uuid = $1",
        [photoId],
      );
      expect(consumedIntent.rows).toHaveLength(0);

      const stats = await cafeWorkStats(dbClient, created.cafeId);
      expect(stats.n_users).toBe(1);
      expect(stats.n_checkins).toBe(1);
      expect(stats.dims.overall).toEqual({ sum: 82, n: 1 });
      expect(stats.experience_score).toBe(82);
      expect(stats.policies.max_stay).toEqual({ unlimited: 1 });

      // Duplicate external id → 409-class error, no second cafe row.
      await expect(
        createCafeWithFirstCheckIn(U1, {
          name: "New Cafe 2",
          lat: 1.35,
          lng: 103.8,
          google_place_id: "ChIJ-test-1",
          checkin: {
            scores: { overall: 82 },
            max_stay: "unlimited",
            note: "dup",
            photo_ids: [],
          },
        }),
      ).rejects.toBeInstanceOf(CafeExistsError);

      const cafe = await getCafe(created.cafeId);
      expect(cafe?.tz).toBe("Asia/Singapore");
      expect(cafe?.name).toBe("New Cafe");

      const nearby = await listCafesNearby({ lat: 1.35, lng: 103.8, radiusKm: 10, limit: 10 });
      expect(nearby.map((c) => c.name)).toEqual(expect.arrayContaining(["Seed Cafe", "New Cafe"]));
    });

    it("recordNavigation inserts and 404s on a missing cafe", async () => {
      const nav = await recordNavigation(U2, CAFE_A);
      expect(nav.resolved).toBe(false);
      expect(nav.created_at).toBeTruthy();

      const stored = await dbClient.query(
        "select cafe_id, user_id, resolved, created_at from navigations where id = $1",
        [nav.id],
      );
      expect(stored.rows[0]).toEqual({
        cafe_id: CAFE_A,
        user_id: U2,
        resolved: false,
        created_at: nav.created_at,
      });

      await expect(
        recordNavigation(U2, "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a00"),
      ).rejects.toBeInstanceOf(CafeNotFoundError);
    });

    it("0004 sync trigger keeps likes_count correct on direct and cascade writes", async () => {
      // Direct insert outside the toggle: the AFTER trigger must sync.
      await dbClient.query(
        "insert into checkin_likes (user_id, checkin_id) values ($1, $2)",
        [U2, CHECKIN_A1],
      );
      const { rows } = await dbClient.query(
        "select likes_count from checkins where id = $1",
        [CHECKIN_A1],
      );
      expect(rows[0].likes_count).toBe(1);

      // Deleting the liking profile cascades the like row while the check-in
      // survives; the trigger must re-sync the counter to zero.
      await dbClient.query("delete from profiles where id = $1", [U2]);
      const after = await dbClient.query(
        "select likes_count from checkins where id = $1",
        [CHECKIN_A1],
      );
      expect(after.rows[0].likes_count).toBe(0);
      const remainingLikes = await dbClient.query(
        "select count(*)::int as n from checkin_likes where checkin_id = $1",
        [CHECKIN_A1],
      );
      expect(remainingLikes.rows[0].n).toBe(0);
    });
  });

  describeDb("work-profile aggregation — work_stats correct via create/edit/soft-delete (issue #146)", () => {
    it("create folds work_stats and coerce preserves both scores via getCafe/listCafesNearby", async () => {
      // Second user's check-in at the seeded cafe
      await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 60, wifi: 70 } });
      const stats = await cafeWorkStats(dbClient, CAFE_A);
      expect(stats.n_users).toBe(2);
      expect(stats.n_checkins).toBe(2);
      expect(stats.experience_score).toBeCloseTo(60, 6);
      // Public-safe consumers read through coerceWorkStats
      const detail = await getCafe(CAFE_A);
      expect(detail?.work_stats.experience_score).toBe(stats.experience_score);
      expect(detail?.work_stats.composite_score).toBeDefined();
      expect(detail?.work_stats.dims.overall.n).toBe(1);
      const nearby = await listCafesNearby({ lat: 1.35, lng: 103.8, radiusKm: 10, limit: 10 });
      const seed = nearby.find((c) => c.id === CAFE_A);
      expect(seed?.work_stats.experience_score).toBe(stats.experience_score);
    });

    it("edit recomputes work_stats for the cafe (recompute, not incremental fold)", async () => {
      const first = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 60 } });
      const before = await cafeWorkStats(dbClient, CAFE_A);
      expect(before.experience_score).toBeCloseTo(60, 6);

      await updateCheckIn(U2, first.checkinId, { scores: { overall: 90 } });
      const after = await cafeWorkStats(dbClient, CAFE_A);
      // Two users now: U1 overall 80 (seed) and U2 90
      expect(after.n_users).toBe(2);
      expect(after.n_checkins).toBe(2);
      expect(after.experience_score).toBeCloseTo(90, 6); // U2's recency-weighted overall is 90
      expect(after.dims.overall.sum).toBe(90);
      const detail = await getCafe(CAFE_A);
      expect(detail?.work_stats.experience_score).toBe(after.experience_score);
    });

    it("soft-delete hides the check-in from work_stats and from cafes.gallery", async () => {
      const photoId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77";
      await recordUploadIntent(U2, photoId);
      const created = await createCheckIn(U2, {
        cafe_id: CAFE_A,
        scores: { overall: 55 },
        photo_ids: [photoId],
      }, fakeProvisionPhotosDeps());
      const withPhoto = await cafeWorkStats(dbClient, CAFE_A);
      expect(withPhoto.n_checkins).toBe(2);
      expect(withPhoto.experience_score).toBe(55);

      const galleryBefore = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      expect(JSON.stringify(galleryBefore.rows[0].gallery)).toContain(photoId);

      await softDeleteCheckIn(U2, created.checkinId);
      const after = await cafeWorkStats(dbClient, CAFE_A);
      expect(after.n_checkins).toBe(1);
      expect(after.n_users).toBe(1);
      // Back to seed user's contribution only
      expect(after.experience_score).toBeNull(); // seed has no overall dim, only wifi
      expect(after.dims.overall).toEqual({ sum: 0, n: 0 });
      // Deleted check-in's photos must not remain in the gallery
      const galleryAfter = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      expect(JSON.stringify(galleryAfter.rows[0].gallery)).not.toContain(photoId);
      // Soft-deleted row still exists but is hidden from recompute
      const deletedRow = await dbClient.query("select deleted_at from checkins where id = $1", [created.checkinId]);
      expect(deletedRow.rows[0].deleted_at).not.toBeNull();
    });

    it("rejects edit/delete from a non-author with 403-class error", async () => {
      const inserted = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 42 } });
      await expect(updateCheckIn(U1, inserted.checkinId, { scores: { overall: 99 } })).rejects.toBeInstanceOf(
        CheckInForbiddenError,
      );
      await expect(softDeleteCheckIn(U1, inserted.checkinId)).rejects.toBeInstanceOf(CheckInForbiddenError);
    });

    it("recomputeAllWorkStats is idempotent and repairs drift", async () => {
      const photoId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a88";
      await recordUploadIntent(U2, photoId);
      await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 77 } }, fakeProvisionPhotosDeps());
      const goodRaw = await cafeWorkStats(dbClient, CAFE_A);
      const good = coerceWorkStats(goodRaw);
      // Corrupt the cached stats to the DB default
      await dbClient.query("update cafes set work_stats = '{}'::jsonb where id = $1", [CAFE_A]);
      const corruptedRaw = await cafeWorkStats(dbClient, CAFE_A);
      const corrupted = coerceWorkStats(corruptedRaw);
      expect(corrupted.n_users).toBe(0);
      expect(corrupted.experience_score).toBeNull();

      // Repair via the nightly entrypoint (same code the cron runs)
      await recomputeAllWorkStats(async (sql, params) => dbClient.query(sql, params));
      const repairedRaw = await cafeWorkStats(dbClient, CAFE_A);
      const repaired = coerceWorkStats(repairedRaw);
      const { updated_at: _goodTs, ...goodNoTs } = good;
      void _goodTs;
      const { updated_at: _repTs, ...repairedNoTs } = repaired;
      void _repTs;
      expect(repairedNoTs).toEqual(goodNoTs);

      // Second run is a no-op (idempotent) — same dims/scores, new timestamp only
      await recomputeAllWorkStats(async (sql, params) => dbClient.query(sql, params));
      const repaired2Raw = await cafeWorkStats(dbClient, CAFE_A);
      const repaired2 = coerceWorkStats(repaired2Raw);
      const { updated_at: _rep2Ts, ...repaired2NoTs } = repaired2;
      void _rep2Ts;
      expect(repaired2NoTs).toEqual(goodNoTs);

      // Public consumers see the repaired scores through coerce
      const detail = await getCafe(CAFE_A);
      expect(detail?.work_stats.experience_score).toBe(good.experience_score);
    });
  });

  describeDb("MERGE_GALLERY_SQL idempotency and partial-overlap semantics (issues #234, #258)", () => {
    it("does not duplicate photo in gallery when same id has a different at timestamp", async () => {
      const photoId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99";
      const photo1 = {
        id: photoId,
        original: "https://img.test/p1-orig.jpg",
        card: "https://img.test/p1-card.webp",
        thumbnail: "https://img.test/p1-thumb.webp",
        w: 800,
        h: 600,
        by: U1,
        at: "2026-08-01T10:00:00.000Z",
        source: { type: "checkin", id: CHECKIN_A1 },
      };
      await dbClient.query(MERGE_GALLERY_SQL, [CAFE_A, JSON.stringify([photo1])]);

      const res1 = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      const gallery1 = res1.rows[0].gallery ?? [];
      const count1 = gallery1.filter((p: { id: string }) => p.id === photoId).length;
      expect(count1).toBe(1);

      // Re-stamp with different 'at' timestamp (e.g. retry re-processing)
      const photo1Restamped = {
        ...photo1,
        at: "2026-08-02T12:00:00.000Z",
      };
      await dbClient.query(MERGE_GALLERY_SQL, [CAFE_A, JSON.stringify([photo1Restamped])]);

      const res2 = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      const gallery2 = res2.rows[0].gallery ?? [];
      const count2 = gallery2.filter((p: { id: string }) => p.id === photoId).length;
      expect(count2).toBe(1);
    });

    it("appends only new photos on partial overlap without duplicating existing ones", async () => {
      const photoIdExisting = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99";
      const photoIdNew = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a9a";
      const existingPhoto = {
        id: photoIdExisting,
        original: "https://img.test/p-exist.jpg",
        card: "https://img.test/p-exist.webp",
        thumbnail: "https://img.test/p-exist.webp",
        w: 800,
        h: 600,
        by: U1,
        at: "2026-08-01T10:00:00.000Z",
        source: { type: "checkin", id: CHECKIN_A1 },
      };
      const newPhoto = {
        id: photoIdNew,
        original: "https://img.test/p-new.jpg",
        card: "https://img.test/p-new.webp",
        thumbnail: "https://img.test/p-new.webp",
        w: 800,
        h: 600,
        by: U1,
        at: "2026-08-01T11:00:00.000Z",
        source: { type: "checkin", id: CHECKIN_A1 },
      };

      // Ensure existingPhoto is in gallery
      await dbClient.query(MERGE_GALLERY_SQL, [CAFE_A, JSON.stringify([existingPhoto])]);

      // Merge array containing both existing and new photo
      await dbClient.query(MERGE_GALLERY_SQL, [CAFE_A, JSON.stringify([existingPhoto, newPhoto])]);

      const { rows } = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      const gallery = rows[0].gallery ?? [];
      expect(gallery.filter((p: { id: string }) => p.id === photoIdExisting)).toHaveLength(1);
      expect(gallery.filter((p: { id: string }) => p.id === photoIdNew)).toHaveLength(1);
    });
  });

  describe("check-in feed (discovery-sheet)", () => {
    // web/config/app.yaml feed.pageSize — the real config value drives paging.
    const PAGE_SIZE = 20;
    const BASE_TS = "2026-08-01T10:00:00.000Z";

    function photoJson(i: number) {
      return JSON.stringify([
        {
          id: `img-${i}`,
          original: `original/img-${i}.webp`,
          card: `card/img-${i}.webp`,
          thumbnail: `thumbnail/img-${i}.webp`,
          w: 800,
          h: 600,
          by: U1,
          at: BASE_TS,
        },
      ]);
    }

    /** Seed `n` check-ins on CAFE_A (author U1), visited 1 minute apart. */
    async function seedFeedCheckins(n: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const id = randomUUID();
        ids.push(id);
        await dbClient.query(
          `insert into checkins (id, cafe_id, user_id, scores, max_stay, note, photos, visited_at)
           values ($1, $2, $3, '{"wifi": 50}'::jsonb, '3h', $4, $5::jsonb,
                   $6::timestamptz + ($7 || ' minutes')::interval)`,
          [id, CAFE_A, U1, `note ${i}`, photoJson(i), BASE_TS, i],
        );
      }
      return ids;
    }

    async function walkFeed(
      mode: "newest" | "helpful",
      viewerId: string | null = null,
    ): Promise<{ ids: string[]; pages: number }> {
      const ids: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await listPublicCheckIns({ cafeId: CAFE_A, mode, cursor, viewerId });
        pages += 1;
        for (const c of page.checkins) ids.push(c.id);
        if (!page.nextCursor) break;
        expect(page.checkins).toHaveLength(PAGE_SIZE);
        cursor = page.nextCursor;
        expect(pages).toBeLessThan(10); // runaway-pagination guard
      }
      return { ids, pages };
    }

    it("newest orders visited_at desc and emits the public DTO shape", async () => {
      const seeded = await seedFeedCheckins(3);
      const page = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: null,
      });
      expect(page.nextCursor).toBeNull();
      // Seed CHECKIN_A1 defaults visited_at to now() — it leads.
      expect(page.checkins.map((c) => c.id)).toEqual([
        CHECKIN_A1,
        seeded[2],
        seeded[1],
        seeded[0],
      ]);
      const row = page.checkins[1];
      expect(row.note).toBe("note 2");
      expect(row.max_stay).toBe("3h");
      expect(row.scores).toEqual({ wifi: 50 });
      expect(row.likes_count).toBe(0);
      expect(row.liked_by_viewer).toBe(false);
      // Public DTO: no author id anywhere (spec 0001).
      expect(row).not.toHaveProperty("user_id");
      expect(row).not.toHaveProperty("deleted_at");
      expect(row.photos).toHaveLength(1);
      expect(row.photos[0]).not.toHaveProperty("by");
      expect(row.photos[0].card).toBe(`card/img-2.webp`);
    });

    it("helpful orders by likes_count desc, then visited_at desc", async () => {
      const seeded = await seedFeedCheckins(3);
      // Extra likers (self-like trigger forbids U1 liking U1's check-ins).
      const U3 = randomUUID();
      await dbClient.query("insert into profiles (id, display_name) values ($1, 'u3')", [U3]);
      // seeded[0]: 2 likes, seeded[2]: 1 like, seeded[1] + CHECKIN_A1: 0.
      await dbClient.query(
        "insert into checkin_likes (user_id, checkin_id) values ($1, $2), ($3, $2), ($1, $4)",
        [U2, seeded[0], U3, seeded[2]],
      );
      const page = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "helpful",
        viewerId: null,
      });
      expect(page.checkins.map((c) => c.id)).toEqual([
        seeded[0],
        seeded[2],
        CHECKIN_A1, // 0 likes, visited_at = now() beats the 2026-08-01 seeds
        seeded[1],
      ]);
      expect(page.checkins[0].likes_count).toBe(2);
      expect(page.checkins[1].likes_count).toBe(1);
    });

    it("paginates both modes by keyset without dupes or gaps", async () => {
      await seedFeedCheckins(PAGE_SIZE + 1); // + baseline = PAGE_SIZE + 2 rows
      for (const mode of ["newest", "helpful"] as const) {
        const { ids, pages } = await walkFeed(mode);
        expect(pages).toBe(2);
        expect(ids).toHaveLength(PAGE_SIZE + 2);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it("excludes soft-deleted check-ins", async () => {
      const seeded = await seedFeedCheckins(2);
      await softDeleteCheckIn(U1, seeded[1]);
      const page = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: null,
      });
      expect(page.checkins.map((c) => c.id)).toEqual([CHECKIN_A1, seeded[0]]);
    });

    it("liked_by_viewer reflects only the viewer's own like", async () => {
      const seeded = await seedFeedCheckins(1);
      await dbClient.query("insert into checkin_likes (user_id, checkin_id) values ($1, $2)", [
        U2,
        seeded[0],
      ]);
      const asLiker = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: U2,
      });
      expect(asLiker.checkins.find((c) => c.id === seeded[0])?.liked_by_viewer).toBe(true);
      const asOther = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: U1,
      });
      expect(asOther.checkins.find((c) => c.id === seeded[0])?.liked_by_viewer).toBe(false);
      const anonymous = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: null,
      });
      expect(anonymous.checkins.every((c) => c.liked_by_viewer === false)).toBe(true);
    });

    it("rejects cross-mode and malformed cursors", async () => {
      await seedFeedCheckins(1);
      const newestCursor = encodeFeedCursor({
        v: 1,
        mode: "newest",
        visited_at: BASE_TS,
        id: CHECKIN_A1,
      });
      await expect(
        listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", cursor: newestCursor, viewerId: null }),
      ).rejects.toBeInstanceOf(FeedCursorError);
      await expect(
        listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", cursor: "garbage", viewerId: null }),
      ).rejects.toBeInstanceOf(FeedCursorError);
    });

    it("survives rows sharing a millisecond across a page boundary", async () => {
      // Microsecond-distinct visited_at inside one JS millisecond: a cursor
      // taken after the first row must still return the second (a millis-
      // truncated cursor would compare BELOW the real stored value and skip
      // it). Only these two rows exist, so the walk is trivial.
      await dbClient.query("delete from checkins where cafe_id = $1", [CAFE_A]);
      const ids: string[] = [];
      for (const fraction of ["10:00:00.123101", "10:00:00.123102"]) {
        const id = randomUUID();
        ids.push(id);
        await dbClient.query(
          `insert into checkins (id, cafe_id, user_id, scores, visited_at)
           values ($1, $2, $3, '{}'::jsonb, $4::timestamptz)`,
          [id, CAFE_A, U1, `2026-08-01 ${fraction}+00`],
        );
      }
      const first = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
      expect(first.checkins.map((c) => c.id)).toEqual([ids[1], ids[0]]);
      const cursorAfterFirst = encodeFeedCursor({
        v: 1,
        mode: "newest",
        visited_at: "2026-08-01T10:00:00.123102Z",
        id: ids[1],
      });
      const rest = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        cursor: cursorAfterFirst,
        viewerId: null,
      });
      expect(rest.checkins[0]?.id).toBe(ids[0]);
    });
  });

  describeDb("seo-sharing queries — sitemap lastmod + gone-cafe location (#150)", () => {
    it("sitemap lastmod prefers work_stats.updated_at, falls back to cafes.updated_at", async () => {
      // Seed cafe has no work_stats.updated_at — the row's updated_at applies.
      const fallback = await listCafeSitemapEntries();
      expect(fallback).toHaveLength(1);
      expect(fallback[0]?.id).toBe(CAFE_A);
      expect(new Date(fallback[0]?.lastmod ?? "").getTime()).not.toBeNaN();

      // A stats update moves lastmod to the aggregate's timestamp (DG105).
      await dbClient.query(
        `update cafes
         set work_stats = jsonb_set(work_stats, '{updated_at}', '"2030-01-02T03:04:05.000Z"')
         where id = $1`,
        [CAFE_A],
      );
      const withStats = await listCafeSitemapEntries();
      expect(withStats[0]?.lastmod).toBe("2030-01-02T03:04:05.000Z");
    });

    it("orders the sitemap newest-lastmod first", async () => {
      const older = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66";
      const newer = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77";
      for (const [id, updated] of [
        [older, "2030-01-01T00:00:00.000Z"],
        [newer, "2030-02-01T00:00:00.000Z"],
      ] as const) {
        await dbClient.query(
          `insert into cafes (id, name, location, work_stats)
           values ($1, $2, ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography,
                   jsonb_build_object('updated_at', $3::text))`,
          [id, `Cafe ${id.slice(-2)}`, updated],
        );
      }
      const entries = await listCafeSitemapEntries();
      expect(entries.map((e) => e.id).indexOf(newer)).toBeLessThan(
        entries.map((e) => e.id).indexOf(older),
      );
    });

    it("getCafeLocation returns coordinates for live and soft-deleted rows, null otherwise", async () => {
      // Seed point is ST_MakePoint(lng=103.8, lat=1.35).
      await expect(getCafeLocation(CAFE_A)).resolves.toEqual({ lat: 1.35, lng: 103.8 });

      // Soft-delete the cafe (issue #207): tombstone coordinates remain accessible for 404 recovery
      const deleted = await softDeleteCafe(CAFE_A);
      expect(deleted).toBe(true);
      await expect(getCafeLocation(CAFE_A)).resolves.toEqual({ lat: 1.35, lng: 103.8 });

      // Live queries and write paths now exclude the soft-deleted cafe
      await expect(getCafe(CAFE_A)).resolves.toBeNull();
      const nearby = await listCafesNearby({ lat: 1.35, lng: 103.8, radiusKm: 10, limit: 10 });
      expect(nearby.some((c) => c.id === CAFE_A)).toBe(false);
      const sitemap = await listCafeSitemapEntries();
      expect(sitemap.some((c) => c.id === CAFE_A)).toBe(false);
      const search = await searchCafesInDb({ q: "Cafe" });
      expect(search.some((c) => c.id === CAFE_A)).toBe(false);

      // Write paths reject targeting a soft-deleted cafe
      await expect(
        createCheckIn(U1, { cafe_id: CAFE_A, scores: { wifi: 50 } }),
      ).rejects.toBeInstanceOf(CafeNotFoundError);
      await expect(
        recordNavigation(U1, CAFE_A),
      ).rejects.toBeInstanceOf(CafeNotFoundError);

      await expect(
        getCafeLocation("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a88"),
      ).resolves.toBeNull();
      // Invalid ids are a normal case on the 404 path — never a throw.
      await expect(getCafeLocation("not-a-uuid")).resolves.toBeNull();
    });

    it("reviveCafe un-deletes a cafe and restores it to queries and sitemap (issue #219)", async () => {
      await softDeleteCafe(CAFE_A);
      expect(await getCafe(CAFE_A)).toBeNull();

      const revived = await reviveCafe(CAFE_A);
      expect(revived).toBe(true);

      const cafe = await getCafe(CAFE_A);
      expect(cafe).not.toBeNull();
      expect(cafe?.id).toBe(CAFE_A);

      const nearby = await listCafesNearby({ lat: 1.35, lng: 103.8, radiusKm: 10, limit: 10 });
      expect(nearby.some((c) => c.id === CAFE_A)).toBe(true);

      const sitemap = await listCafeSitemapEntries();
      expect(sitemap.some((c) => c.id === CAFE_A)).toBe(true);
    });

    it("permits creating a new cafe with the same external POI after soft-delete (issue #219)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const initial = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "External Cafe",
          lat: 1.35,
          lng: 103.8,
          google_place_id: "ChIJ_reimport_test",
          checkin: { scores: { wifi: 80, overall: 80 }, max_stay: "unlimited", note: "first", photo_ids: [photoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      await softDeleteCafe(initial.cafeId);

      const secondPhotoId = randomUUID();
      await recordUploadIntent(U1, secondPhotoId);
      const recreated = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "External Cafe Reborn",
          lat: 1.35,
          lng: 103.8,
          google_place_id: "ChIJ_reimport_test",
          checkin: { scores: { wifi: 90, overall: 90 }, max_stay: "unlimited", note: "second", photo_ids: [secondPhotoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      expect(recreated.cafeId).not.toBe(initial.cafeId);
      const live = await getCafe(recreated.cafeId);
      expect(live?.name).toBe("External Cafe Reborn");
    });

    it("recomputeAllWorkStats skips soft-deleted cafes (issue #219)", async () => {
      await softDeleteCafe(CAFE_A);
      await expect(recomputeAllWorkStats(dbClient.query.bind(dbClient))).resolves.toBeUndefined();
      expect(await getCafe(CAFE_A)).toBeNull();
    });

    it("reviveCafe refuses to un-delete when the POI was re-imported live (issue #228)", async () => {
      // The re-import scenario #225 enabled: tombstone the original, then
      // recreate the same external POI as a new live row.
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const initial = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Revive Conflict Cafe",
          lat: 1.35,
          lng: 103.8,
          google_place_id: "ChIJ_revive_conflict",
          checkin: { scores: { wifi: 70, overall: 70 }, max_stay: "unlimited", note: "first", photo_ids: [photoId] },
        },
        fakeProvisionPhotosDeps(),
      );
      await softDeleteCafe(initial.cafeId);

      const secondPhotoId = randomUUID();
      await recordUploadIntent(U1, secondPhotoId);
      const recreated = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Revive Conflict Cafe Reborn",
          lat: 1.35,
          lng: 103.8,
          google_place_id: "ChIJ_revive_conflict",
          checkin: { scores: { wifi: 90, overall: 90 }, max_stay: "unlimited", note: "second", photo_ids: [secondPhotoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      // Reviving the old tombstone would collide with the partial unique
      // index: clean refusal, and both rows keep their state.
      await expect(reviveCafe(initial.cafeId)).resolves.toBe(false);
      await expect(getCafe(initial.cafeId)).resolves.toBeNull();
      const live = await getCafe(recreated.cafeId);
      expect(live?.name).toBe("Revive Conflict Cafe Reborn");

      // Once the replacement is tombstoned, reviving the original works again.
      await softDeleteCafe(recreated.cafeId);
      await expect(reviveCafe(initial.cafeId)).resolves.toBe(true);
      await expect(getCafe(initial.cafeId)).resolves.not.toBeNull();
    });

    it("softDeleteCafe with a creator scope deletes only for the creator (issue #228)", async () => {
      // CAFE_A is seeded with created_by = U1.
      await expect(softDeleteCafe(CAFE_A, U2)).resolves.toBe(false);
      await expect(getCafe(CAFE_A)).resolves.not.toBeNull(); // mismatch leaves the row live

      await expect(softDeleteCafe(CAFE_A, U1)).resolves.toBe(true);
      await expect(getCafe(CAFE_A)).resolves.toBeNull();

      // Already tombstoned: false again, even for the creator.
      await expect(softDeleteCafe(CAFE_A, U1)).resolves.toBe(false);
    });
  });

  describeDb("searchCafesInDb on real Postgres (search and filters)", () => {
    it("matches cafes by ILIKE substring and FTS text query", async () => {
      const results = await searchCafesInDb({ q: "Cafe" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.name).toContain("Cafe");
      expect(typeof results[0]?.lat).toBe("number");
      expect(typeof results[0]?.lng).toBe("number");
      expect(results[0]?.work_stats).toBeDefined();
    });

    it("preserves AND grouping between city filter and name search OR condition", async () => {
      // Query matches cafe name in DB, but city is constrained to Tokyo where no such cafe exists
      const resultsTokyo = await searchCafesInDb({ q: "Cafe", city: "tokyo" });
      expect(resultsTokyo).toHaveLength(0);

      // Query with matching city returns the cafe
      const resultsSing = await searchCafesInDb({ q: "Cafe", city: "singapore" });
      expect(resultsSing.length).toBeGreaterThanOrEqual(1);
      expect(resultsSing.every((c) => c.city?.toLowerCase() === "singapore")).toBe(true);
    });

    it("filters cafes by city case-insensitively", async () => {
      const resultsSing = await searchCafesInDb({ city: "Singapore" });
      expect(resultsSing.every((c) => c.city?.toLowerCase() === "singapore")).toBe(true);

      const resultsEmpty = await searchCafesInDb({ city: "NonExistentCity" });
      expect(resultsEmpty).toHaveLength(0);
    });

    it("respects the limit parameter and returns work_stats", async () => {
      const results = await searchCafesInDb({ limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describeDb("profile queries on real Postgres (profile-page slice #152)", () => {
    it("gets user profile and stats accurately", async () => {
      const p = await getProfile(U1);
      expect(p).not.toBeNull();
      expect(p?.id).toBe(U1);
      expect(p?.displayName).toBe("u1");

      const s = await getUserStats(U1);
      expect(s.cafesCount).toBeGreaterThanOrEqual(1);
      expect(s.checkinsCount).toBeGreaterThanOrEqual(1);
    });

    it("updates display_name and current_city", async () => {
      const updated = await updateProfile(U1, {
        displayName: "Nomad Alex",
        currentCity: "tokyo",
      });
      expect(updated?.displayName).toBe("Nomad Alex");
      expect(updated?.currentCity).toBe("tokyo");

      const fetched = await getProfile(U1);
      expect(fetched?.displayName).toBe("Nomad Alex");
      expect(fetched?.currentCity).toBe("tokyo");
    });

    it("returns user check-ins and distinct cafes with pagination", async () => {
      const checkinsResult = await getUserCheckIns(U1, { limit: 10 });
      expect(checkinsResult.items.length).toBeGreaterThanOrEqual(1);
      expect(checkinsResult.items[0]?.cafeId).toBe(CAFE_A);

      const cafesResult = await getUserCafes(U1, { limit: 10 });
      expect(cafesResult.items.length).toBeGreaterThanOrEqual(1);
      expect(cafesResult.items[0]?.id).toBe(CAFE_A);
      expect(cafesResult.items[0]?.isCreation).toBe(true);
    });

    it("correctly handles soft-deleted cafes in stats, check-ins, and cafe lists (issue #219)", async () => {
      const CAFE_B = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a88";
      const CHECKIN_B1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99";
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz)
         values ($1, 'Cafe B', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, 'singapore', $2, 'Asia/Singapore')`,
        [CAFE_B, U1],
      );
      await dbClient.query(
        `insert into checkins (id, cafe_id, user_id, is_creation, scores)
         values ($1, $2, $3, false, '{"coffee": 90}'::jsonb)`,
        [CHECKIN_B1, CAFE_B, U1],
      );

      const beforeStats = await getUserStats(U1);
      expect(beforeStats.cafesCount).toBe(2);
      expect(beforeStats.checkinsCount).toBe(2);

      await softDeleteCafe(CAFE_B);

      // cafesCount excludes soft-deleted cafe; checkinsCount still counts checkins
      const afterStats = await getUserStats(U1);
      expect(afterStats.cafesCount).toBe(1);
      expect(afterStats.checkinsCount).toBe(2);

      // getUserCheckIns returns cafeIsDeleted = true for deleted cafe
      const checkins = await getUserCheckIns(U1);
      const bCheckin = checkins.items.find((i) => i.id === CHECKIN_B1);
      expect(bCheckin?.cafeIsDeleted).toBe(true);
      const aCheckin = checkins.items.find((i) => i.id === CHECKIN_A1);
      expect(aCheckin?.cafeIsDeleted).toBe(false);

      // getUserCafes completely excludes soft-deleted cafe
      const userCafes = await getUserCafes(U1);
      expect(userCafes.items.some((c) => c.id === CAFE_B)).toBe(false);
      expect(userCafes.items.some((c) => c.id === CAFE_A)).toBe(true);
    });

    it("completeImageUpload rejects attaching to a soft-deleted cafe on real Postgres (issue #219)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      await softDeleteCafe(CAFE_A);

      const deps = {
        ...defaultCompleteUploadDeps(),
        getProcessUrls: async ({ imageUuid }: { imageUuid: string }) => fakeProcessUrls(imageUuid),
        processImage: async (imageUuid: string) => ({
          imageUuid,
          publicUrls: fakeProcessUrls(imageUuid).publicUrls,
          width: 800,
          height: 600,
        }),
      };

      const result = await completeImageUpload(
        { id: U1 },
        {
          imageUuid: photoId,
          targetType: "cafe",
          targetId: CAFE_A,
          isCover: false,
        },
        deps,
      );

      expect(result.attached).toBe(false);
    });
  });
});
