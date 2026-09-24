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
  DuplicateCheckInError,
  SelfLikeError,
} from "@/lib/validation/checkin";
import {
  MERGE_GALLERY_SQL,
  createCheckIn,
  getLastCheckinForCafe,
  softDeleteCheckIn,
  toggleCheckInLike,
  updateCheckIn,
} from "@/lib/db/checkins";
import {
  CafeExistsError,
  CafeForbiddenError,
  CafeHasOtherCheckinsError,
} from "@/lib/validation/cafe";
import {
  cafeExists,
  createCafeWithFirstCheckIn,
  deleteCafe,
  getCafe,
  getCafeLocation,
  isServiceMaintained,
  listCafeSitemapEntries,
  listCafesNearby,
  resolveCafeTimezone,
  setCafeVisibility,
  toPublicCafeDetail,
  type CafeDetailWithAuthor,
} from "@/lib/db/cafes";
import {
  deleteAccount,
  getProfile,
  getProfileExport,
  getUserStats,
  updateProfile,
  getUserCheckIns,
  getUserCafes,
} from "@/lib/db/profile";
import {
  updateProfileIdentity,
  InvalidHandleError,
  HandleTakenError,
  HandleChangeTooSoonError,
} from "@/lib/db/identity";
import { cafesDataVersion, searchCafesInDb } from "@/lib/db/search";
import { isOpenAt } from "@/lib/hours";
import { executeSearch } from "@/lib/search/search-service";
import {
  navigationPromptQueue,
  parseNavigationBody,
  recordNavigation,
} from "@/lib/db/navigations";
import {
  FeedCursorError,
  encodeFeedCursor,
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import { selectLivePhotoReferences, selectPhotoReferences } from "@/lib/db/photo-references";
import { compensateProvisionedPhotos, PhotoIntentError } from "@/lib/images/provision-photos";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { recomputeAllWorkStats } from "@/lib/stats/aggregate";
import { coerceWorkStats } from "@/lib/stats/work-stats";
import { appConfig } from "@/lib/config";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import {
  CAFE_A,
  CHECKIN_A1,
  SERVICE_ACCOUNT_ID,
  U1,
  U2,
  cafeWorkStats,
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
      "truncate table profiles, cafes, image_upload_intents, navigations restart identity cascade",
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
      try {
        await cleanupIntegrationDatabase(adminDbUrl, TEST_DB);
      } catch (error) {
        errors.push(error);
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
  }, 60_000);

  it("applies migrations 0001→0031 and installs PostGIS + both triggers", async () => {
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
      "0013_search_city_index.sql",
      "0014_fk_indexes_and_partial_gist.sql",
      "0015_drop_dead_cafe_columns.sql",
      "0016_seed_service_account.sql",
      "0017_cafe_visibility.sql",
      "0018_public_identity.sql",
      "0019_checkin_idempotency.sql",
      "0020_navigation_prompt_queue.sql",
      "0021_helpful_ranking.sql",
      "0022_profiles_onboarded.sql",
      "0023_runtime_config.sql",
      "0024_service_account_rename.sql",
      "0025_drop_cafes_cover.sql",
      "0026_drop_rate_limits.sql",
      "0027_navigation_unresolved_dedupe.sql",
      "0028_open_now_sql_function.sql",
      "0029_open_now_24h_window.sql",
      "0030_cafe_source.sql",
      "0031_profile_city_backfill_audit.sql",
    ]);

    const serviceProfile = await dbClient.query(
      "select * from profiles where id = '00000000-0000-4000-a000-000000000001'",
    );
    expect(serviceProfile.rows).toHaveLength(1);
    expect(serviceProfile.rows[0].display_name).toBe("CafeMood");
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

    // Issue #244: Verify FK indexes and partial GiST exist, and dead GIN/old GiST dropped
    const indexRows = await dbClient.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'`,
    );
    const indexNames = new Set(indexRows.rows.map((r) => r.indexname));
    expect(indexNames.has("idx_checkin_likes_user_id")).toBe(true);
    expect(indexNames.has("idx_navigations_cafe_id")).toBe(true);
    expect(indexNames.has("idx_image_upload_intents_user_id")).toBe(true);
    expect(indexNames.has("idx_cafes_location_active")).toBe(true);
    expect(indexNames.has("idx_cafes_location")).toBe(false);
    expect(indexNames.has("idx_cafes_gallery")).toBe(false);
    expect(indexNames.has("idx_checkins_photos")).toBe(false);

    // DG147: Verify idx_cafes_location_active predicate has visibility = 'public' and no redundant idx_cafes_visibility_public
    const gistRes = await dbClient.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'idx_cafes_location_active'`,
    );
    expect(gistRes.rows[0].indexdef).toContain("visibility = 'public'");
    expect(indexNames.has("idx_cafes_visibility_public")).toBe(false);

    // Issue #253: Verify dead columns owner_id and slug are dropped from cafes
    const colRows = await dbClient.query<{ column_name: string; column_default: string | null }>(
      `select column_name, column_default from information_schema.columns where table_name = 'cafes'`,
    );
    const colNames = new Set(colRows.rows.map((r) => r.column_name));
    expect(colNames.has("owner_id")).toBe(false);
    expect(colNames.has("visibility")).toBe(true);
    // BRAWUKA-620: 0030 adds the cafe source marker (default 'user_confirmed').
    expect(colNames.has("source")).toBe(true);
    expect(colRows.rows.find((r) => r.column_name === "source")?.column_default).toContain("user_confirmed");

    // BRAWUKA-695: 0031 creates profile_city_backfill_audit table
    const auditColRows = await dbClient.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'profile_city_backfill_audit'`,
    );
    const auditColNames = new Set(auditColRows.rows.map((r) => r.column_name));
    expect(auditColNames.has("user_id")).toBe(true);
    expect(auditColNames.has("old_city")).toBe(true);
    expect(auditColNames.has("new_city")).toBe(true);
    expect(auditColNames.has("migrated_at")).toBe(true);

    // Issue #139: Verify 0018_public_identity columns on profiles and unique partial index
    const profileColRows = await dbClient.query<{ column_name: string; data_type: string; column_default: string | null }>(
      `select column_name, data_type, column_default from information_schema.columns where table_name = 'profiles'`,
    );
    const profileColNames = new Set(profileColRows.rows.map((r) => r.column_name));
    expect(profileColNames.has("show_public_identity")).toBe(true);
    expect(profileColNames.has("public_handle")).toBe(true);
    expect(profileColNames.has("identity_consented_at")).toBe(true);
    expect(profileColNames.has("public_handle_changed_at")).toBe(true);

    const handleIndexRes = await dbClient.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'idx_profiles_public_handle'`,
    );
    expect(handleIndexRes.rows).toHaveLength(1);
    expect(handleIndexRes.rows[0].indexdef).toContain("public_handle IS NOT NULL");
    expect(handleIndexRes.rows[0].indexdef).toContain("UNIQUE INDEX");

    // BRAWUKA-119 (DG61): 0019 adds a nullable idempotency_key scoped per
    // user by a partial unique index — NULL rows (legacy, fused creation)
    // stay outside the uniqueness scope.
    const checkinColRows = await dbClient.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_name = 'checkins'`,
    );
    const keyCol = checkinColRows.rows.find((r) => r.column_name === "idempotency_key");
    expect(keyCol?.data_type).toBe("uuid");
    const idemIndexRes = await dbClient.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'idx_checkins_user_idempotency'`,
    );
    expect(idemIndexRes.rows).toHaveLength(1);
    expect(idemIndexRes.rows[0].indexdef).toContain("UNIQUE INDEX");
    expect(idemIndexRes.rows[0].indexdef).toContain("idempotency_key IS NOT NULL");
  });

  describeDb("toggleCheckInLike on real SQL", () => {
    it("likes and unlikes another user's check-in, keeping likes_count in sync", async () => {
      const liked = await toggleCheckInLike(U2, CHECKIN_A1);
      expect(liked).toEqual({ liked: true, likes_count: 1 });

      const { rows } = await dbClient.query(
        "select likes_count from checkins where id = $1",
        [CHECKIN_A1],
      );
      expect(rows[0].likes_count).toBe(1);

      const unliked = await toggleCheckInLike(U2, CHECKIN_A1);
      expect(unliked).toEqual({ liked: false, likes_count: 0 });
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

    it("404s a non-owner like on a private cafe's check-in (BRAWUKA-634)", async () => {
      await setCafeVisibility(CAFE_A, U1, "private");

      // U2 is neither the check-in author nor the cafe creator: the
      // viewer-scoped gate filters the CTE, so the toggle 404s and writes
      // nothing instead of leaking the check-in's existence via a like.
      await expect(toggleCheckInLike(U2, CHECKIN_A1)).rejects.toBeInstanceOf(CheckInNotFoundError);
      const { rows } = await dbClient.query(
        "select count(*)::int as n from checkin_likes where checkin_id = $1",
        [CHECKIN_A1],
      );
      expect(rows[0].n).toBe(0);

      // Owner still passes the gate: the self-like rule (not 404) fires.
      await expect(toggleCheckInLike(U1, CHECKIN_A1)).rejects.toBeInstanceOf(SelfLikeError);

      // Back to public: the stranger can like again.
      await setCafeVisibility(CAFE_A, U1, "public");
      const liked = await toggleCheckInLike(U2, CHECKIN_A1);
      expect(liked).toEqual({ liked: true, likes_count: 1 });
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
      expect(legacy).toEqual({ liked: false, likes_count: 0 });

      const { rows } = await dbClient.query(
        "select count(*)::int as n from checkin_likes where checkin_id = $1",
        [CHECKIN_A1],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describeDb("write paths on real SQL", () => {
    it("createCheckIn folds the new check-in into work_stats (incremental)", async () => {
      const result = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 60 } });
      expect(result.checkin_id).toMatch(/^[0-9a-f-]{36}$/);

      const stats = await cafeWorkStats(dbClient, CAFE_A);
      expect(stats.n_users).toBe(2);
      expect(stats.n_checkins).toBe(2);
      expect(stats.dims.overall).toEqual({ sum: 60, n: 1 });
      expect(stats.experience_score).toBe(60);
    });

    it("createCheckIn rejects a second check-in inside the revisit window, allows one past it (DG64)", async () => {
      const first = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 60 } });

      // A same-day revisit is an edit, not a new row: rejected with the live id.
      const err = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 70 } }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(DuplicateCheckInError);
      expect((err as DuplicateCheckInError).existingCheckinId).toBe(first.checkin_id);

      // The rejected write leaves no row behind.
      const { rows } = await dbClient.query(
        "select count(*)::int as n from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
        [CAFE_A, U2],
      );
      expect(rows[0].n).toBe(1);

      // Past the window the same user can check in again (visited_at-keyed).
      await dbClient.query("update checkins set visited_at = now() - interval '25 hours' where id = $1", [
        first.checkin_id,
      ]);
      const second = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 70 } });
      expect(second.checkin_id).not.toBe(first.checkin_id);

      // A soft-deleted check-in no longer blocks the window either.
      await softDeleteCheckIn(U2, second.checkin_id);
      const third = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 80 } });
      expect(third.checkin_id).not.toBe(second.checkin_id);
    });

    it("serializes two concurrent createCheckIn calls: one wins, one throws DuplicateCheckInError (BRAWUKA-125)", async () => {
      // True concurrency: both transactions overlap. The pg_advisory_xact_lock
      // in createCheckIn serializes same user+cafe writers, so the loser
      // re-reads the winner's committed row (READ COMMITTED per-statement
      // snapshot) and hits the DG64 window check. Distinct idempotency keys
      // keep the DG61 dedupe path out of the picture.
      const [a, b] = await Promise.allSettled([
        createCheckIn(U2, {
          cafe_id: CAFE_A,
          scores: { overall: 60 },
          idempotency_key: randomUUID(),
        }),
        createCheckIn(U2, {
          cafe_id: CAFE_A,
          scores: { overall: 70 },
          idempotency_key: randomUUID(),
        }),
      ]);
      const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
      const rejected = [a, b].filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateCheckInError);

      const { rows } = await dbClient.query(
        "select count(*)::int as n from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
        [CAFE_A, U2],
      );
      expect(rows[0].n).toBe(1);
    });

    it("createCheckIn dedupes on idempotency_key: replay returns the same id, no second row (DG61)", async () => {
      const key = randomUUID();
      const first = await createCheckIn(U2, {
        cafe_id: CAFE_A,
        scores: { overall: 60 },
        idempotency_key: key,
      });
      expect(first.deduped).toBe(false);

      const stored = await dbClient.query(
        "select idempotency_key from checkins where id = $1",
        [first.checkin_id],
      );
      expect(stored.rows[0].idempotency_key).toBe(key);

      // "Request persisted but response lost": the drawer retries with the
      // SAME key — the server must return the original id and write nothing.
      const replay = await createCheckIn(U2, {
        cafe_id: CAFE_A,
        scores: { overall: 60 },
        idempotency_key: key,
      });
      expect(replay).toEqual({ checkin_id: first.checkin_id, deduped: true });

      const { rows } = await dbClient.query(
        "select count(*)::int as n from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
        [CAFE_A, U2],
      );
      expect(rows[0].n).toBe(1);

      // A different key is a different write: past the DG64 window it
      // inserts a new row instead of deduping.
      await dbClient.query("update checkins set visited_at = now() - interval '25 hours' where id = $1", [
        first.checkin_id,
      ]);
      const second = await createCheckIn(U2, {
        cafe_id: CAFE_A,
        scores: { overall: 70 },
        idempotency_key: randomUUID(),
      });
      expect(second.checkin_id).not.toBe(first.checkin_id);
      expect(second.deduped).toBe(false);
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
        [created.checkin_id],
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
          source: { type: "checkin", id: created.checkin_id },
        }),
      ]);

      const storedGallery = await dbClient.query("select gallery from cafes where id = $1", [
        created.cafe_id,
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
          source: { type: "checkin", id: created.checkin_id },
        }),
      ]);
      const consumedIntent = await dbClient.query(
        "select image_uuid from image_upload_intents where image_uuid = $1",
        [photoId],
      );
      expect(consumedIntent.rows).toHaveLength(0);

      const stats = await cafeWorkStats(dbClient, created.cafe_id);
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

      const cafe = await getCafe(created.cafe_id);
      expect(cafe?.tz).toBe("Asia/Singapore");
      expect(cafe?.name).toBe("New Cafe");
      // BRAWUKA-620: user-created cafes carry the user_confirmed source marker.
      expect(cafe?.source).toBe("user_confirmed");

      const nearby = await listCafesNearby({ lat: 1.35, lng: 103.8, radiusKm: 10, limit: 10 });
      expect(nearby.map((c) => c.name)).toEqual(expect.arrayContaining(["Seed Cafe", "New Cafe"]));
    });

    it("selectPhotoReferences gates compensation on live rows (BRAWUKA-401)", async () => {
      const photoId = randomUUID();
      const orphanId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Reference Gate Cafe",
          lat: 1.35,
          lng: 103.8,
          city: "singapore",
          checkin: {
            scores: { overall: 80 },
            max_stay: "unlimited",
            note: "gated",
            photo_ids: [photoId],
          },
        },
        fakeProvisionPhotosDeps(),
      );

      // Winner committed: gallery + check-in rows reference the id, so the
      // loser's compensation must keep it while deleting true orphans.
      await expect(selectPhotoReferences([photoId, orphanId])).resolves.toEqual([photoId]);

      // Live-intent gate (BRAWUKA-502): an uncommitted winner holds no DB
      // row yet, but its intent row is still live — full compensation for
      // the same user+id pair deletes nothing. `U1`'s intent was consumed
      // by the winner's commit, so simulate the in-flight state with a
      // fresh intent issued to the same user.
      const inFlightId = randomUUID();
      await recordUploadIntent(U1, inFlightId);
      const deps = fakeProvisionPhotosDeps();
      const deleted: string[] = [];
      const realDelete = deps.deleteProvisionedVariants;
      if (!realDelete) throw new Error("expected a delete dep in the fixture");
      deps.deleteProvisionedVariants = async (id) => {
        deleted.push(id);
        await realDelete(id);
      };
      await compensateProvisionedPhotos(U1, [inFlightId, orphanId], deps);
      expect(deleted).toEqual([orphanId]);
      expect(selectPhotoReferences([photoId, orphanId])).resolves.toEqual([photoId]);

      // A soft-deleted check-in still references its photos until the row is
      // gone: the gate keeps protecting the R2 objects after delete.
      await dbClient.query("update checkins set deleted_at = now() where id = $1", [
        created.checkin_id,
      ]);
      await expect(selectPhotoReferences([photoId])).resolves.toEqual([photoId]);

      // The delete path's live-only gate (BRAWUKA-433) answers differently:
      // once the gallery entry is purged (what softDeleteCheckIn does), the
      // tombstoned row's photos are no longer live-referenced — while the
      // rollback gate above still protects them.
      await dbClient.query(
        `update cafes set gallery = coalesce(
           (select jsonb_agg(elem) from jsonb_array_elements(coalesce(gallery, '[]'::jsonb)) elem
            where elem->>'id' <> $2), '[]'::jsonb) where id = $1`,
        [created.cafe_id, photoId],
      );
      await expect(selectLivePhotoReferences([photoId])).resolves.toEqual([]);
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

    it("recordNavigation deduplicates unresolved rows: repeat taps refresh created_at and reset ask counters (BRAWUKA-391)", async () => {
      // 1. Initial navigation
      const first = await recordNavigation(U1, CAFE_A);
      expect(first.resolved).toBe(false);

      // Simulate a deferral: ask_count=2, last_asked_at set, created_at in the past
      await dbClient.query(
        "update navigations set ask_count = 2, last_asked_at = now() - interval '1 day', created_at = now() - interval '3 days' where id = $1",
        [first.id],
      );

      // 2. Repeat navigation for same user and cafe
      const second = await recordNavigation(U1, CAFE_A);
      expect(second.id).toBe(first.id);
      expect(second.resolved).toBe(false);
      expect(new Date(second.created_at).getTime()).toBeGreaterThan(new Date(first.created_at).getTime());

      // Verify only 1 unresolved row exists in the DB, ask_count reset to 0, last_asked_at is null
      const rows = (
        await dbClient.query(
          "select id, ask_count, last_asked_at, resolved from navigations where user_id = $1 and cafe_id = $2 and resolved = false",
          [U1, CAFE_A],
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: first.id,
        ask_count: 0,
        last_asked_at: null,
        resolved: false,
      });

      // 3. Resolve it (e.g. visited)
      await dbClient.query("update navigations set resolved = true, outcome = 'visited' where id = $1", [first.id]);

      // 4. Next navigation after resolve creates a new unresolved row
      const third = await recordNavigation(U1, CAFE_A);
      expect(third.id).not.toBe(first.id);
      expect(third.resolved).toBe(false);
    });

    it("navigation prompt queue: eligibility, answers, and auto-resolve on real SQL", async () => {
      // Fresh navigation — too young to prompt (DG78: earliest next day).
      const fresh = await recordNavigation(U2, CAFE_A);
      expect(await navigationPromptQueue.next(U2)).toBeNull();

      // Age it past the 24h minimum — now it is the eligible prompt.
      await dbClient.query(
        "update navigations set created_at = now() - interval '2 days' where id = $1",
        [fresh.id],
      );
      const item = await navigationPromptQueue.next(U2);
      expect(item?.id).toBe(fresh.id);
      expect(item?.cafe.name).toBe("Seed Cafe");

      // 还没去 → back of the queue: stamped, counted, not eligible again
      // until the re-ask delay passes.
      await navigationPromptQueue.answer(U2, fresh.id, "not_yet");
      expect(await navigationPromptQueue.next(U2)).toBeNull();
      let row = (
        await dbClient.query(
          "select resolved, outcome, ask_count, last_asked_at from navigations where id = $1",
          [fresh.id],
        )
      ).rows[0];
      expect(row).toMatchObject({ resolved: false, outcome: null, ask_count: 1 });
      expect(row.last_asked_at).toBeTruthy();

      // Past the re-ask delay it is eligible again; the (maxReasks + 1)-th
      // "not yet" auto-resolves (DG91).
      await dbClient.query(
        "update navigations set last_asked_at = now() - interval '2 days' where id = $1",
        [fresh.id],
      );
      expect((await navigationPromptQueue.next(U2))?.id).toBe(fresh.id);
      await navigationPromptQueue.answer(U2, fresh.id, "not_yet");
      await dbClient.query(
        "update navigations set last_asked_at = now() - interval '2 days' where id = $1",
        [fresh.id],
      );
      await navigationPromptQueue.answer(U2, fresh.id, "not_yet");
      row = (
        await dbClient.query(
          "select resolved, outcome, ask_count from navigations where id = $1",
          [fresh.id],
        )
      ).rows[0];
      expect(row).toMatchObject({ resolved: true, outcome: "auto", ask_count: 3 });

      // Expired (> 3 months, DG83) and resolved rows never prompt.
      const old = await recordNavigation(U2, CAFE_A);
      await dbClient.query(
        "update navigations set created_at = now() - interval '100 days' where id = $1",
        [old.id],
      );
      expect(await navigationPromptQueue.next(U2)).toBeNull();

      // 不去了 resolves permanently and idempotently — a repeat answer
      // returns the stored outcome instead of overwriting it (DG80).
      const gone = await recordNavigation(U2, CAFE_A);
      await dbClient.query(
        "update navigations set created_at = now() - interval '2 days' where id = $1",
        [gone.id],
      );
      await navigationPromptQueue.answer(U2, gone.id, "wont_go");
      await expect(
        navigationPromptQueue.answer(U2, gone.id, "visited"),
      ).resolves.toEqual({ status: "answered", outcome: "wont_go" });
      await expect(
        navigationPromptQueue.answer(U2, "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a00", "visited"),
      ).resolves.toEqual({ status: "gone" });

      // DG79: a check-in at the cafe silently resolves the pending
      // navigation inside the same transaction.
      const pending = await recordNavigation(U2, CAFE_A);
      await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 70 } });
      row = (
        await dbClient.query(
          "select resolved, outcome from navigations where id = $1",
          [pending.id],
        )
      ).rows[0];
      expect(row).toMatchObject({ resolved: true, outcome: "auto" });
    });

    it("navigation prompt answers resolve the whole same-cafe stack (BRAWUKA-270)", async () => {
      const nav = async (id: string) =>
        (
          await dbClient.query(
            "select resolved, outcome, ask_count from navigations where id = $1",
            [id],
          )
        ).rows[0];

      // A second cafe proves the update is cafe-scoped, not user-wide.
      const CAFE_B = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66";
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz)
         values ($1, 'Other Cafe', ST_SetSRID(ST_MakePoint(103.81, 1.35), 4326)::geography,
                 'singapore', $2, 'Asia/Singapore')`,
        [CAFE_B, U1],
      );

      // Two stacked taps to CAFE_A, one tap to CAFE_B, one tap by another
      // user. Distinct ages keep the most-recent-first order deterministic.
      const first = await recordNavigation(U2, CAFE_A);
      const otherCafe = await recordNavigation(U2, CAFE_B);
      const second = await recordNavigation(U2, CAFE_A);
      const otherUser = await recordNavigation(U1, CAFE_A);
      await dbClient.query(
        "update navigations set created_at = now() - interval '3 days' where id = $1",
        [first.id],
      );
      await dbClient.query(
        "update navigations set created_at = now() - interval '4 days' where id = $1",
        [otherCafe.id],
      );
      await dbClient.query(
        "update navigations set created_at = now() - interval '2 days' where id = $1",
        [second.id],
      );

      // 不去了 on the newest CAFE_A row retires the whole stack for that
      // cafe — the older row can never re-prompt in a later session.
      expect((await navigationPromptQueue.next(U2))?.id).toBe(second.id);
      await navigationPromptQueue.answer(U2, second.id, "wont_go");
      expect(await nav(first.id)).toMatchObject({ resolved: true, outcome: "wont_go" });
      expect(await nav(second.id)).toMatchObject({ resolved: true, outcome: "wont_go" });
      // Other cafes and other users' rows are untouched.
      expect(await nav(otherCafe.id)).toMatchObject({ resolved: false, outcome: null });
      expect(await nav(otherUser.id)).toMatchObject({ resolved: false, outcome: null });
      expect((await navigationPromptQueue.next(U2))?.id).toBe(otherCafe.id);
      await navigationPromptQueue.answer(U2, otherCafe.id, "wont_go");

      // Stale re-answer on a resolved id is a no-op for the stack: a retry
      // of the original answer must not consume a fresh navigation the
      // user was never prompted about (P1 review finding).
      const fresh = await recordNavigation(U2, CAFE_A);
      await expect(
        navigationPromptQueue.answer(U2, second.id, "wont_go"),
      ).resolves.toEqual({ status: "answered", outcome: "wont_go" });
      expect(await nav(fresh.id)).toMatchObject({ resolved: false, outcome: null });
      await navigationPromptQueue.answer(U2, fresh.id, "wont_go");

      // 还没去 defers the whole stack: one shared re-ask budget, so the
      // (maxReasks + 1)-th answer auto-resolves every stacked row (DG91) —
      // three prompts total, not two per row.
      const d1 = await recordNavigation(U2, CAFE_A);
      const d2 = await recordNavigation(U2, CAFE_A);
      await dbClient.query(
        "update navigations set created_at = now() - interval '3 days' where id = $1",
        [d1.id],
      );
      await dbClient.query(
        "update navigations set created_at = now() - interval '2 days' where id = $1",
        [d2.id],
      );
      const reask = async () => {
        const item = await navigationPromptQueue.next(U2);
        expect(item).not.toBeNull();
        await navigationPromptQueue.answer(U2, item!.id, "not_yet");
        await dbClient.query(
          "update navigations set last_asked_at = now() - interval '2 days' where resolved = false and user_id = $1",
          [U2],
        );
      };
      await reask();
      expect(await nav(d1.id)).toMatchObject({ resolved: false, ask_count: 1 });
      expect(await nav(d2.id)).toMatchObject({ resolved: false, ask_count: 1 });
      await reask();
      await reask();
      expect(await nav(d1.id)).toMatchObject({ resolved: true, outcome: "auto", ask_count: 3 });
      expect(await nav(d2.id)).toMatchObject({ resolved: true, outcome: "auto", ask_count: 3 });

      // 有去！ also retires the stack — siblings take the same outcome.
      const v1 = await recordNavigation(U2, CAFE_A);
      const v2 = await recordNavigation(U2, CAFE_A);
      await dbClient.query(
        "update navigations set created_at = now() - interval '3 days' where id = $1",
        [v1.id],
      );
      await dbClient.query(
        "update navigations set created_at = now() - interval '2 days' where id = $1",
        [v2.id],
      );
      const shown = await navigationPromptQueue.next(U2);
      expect(shown?.id).toBe(v2.id);
      await navigationPromptQueue.answer(U2, v2.id, "visited");
      expect(await nav(v1.id)).toMatchObject({ resolved: true, outcome: "visited" });
      expect(await nav(v2.id)).toMatchObject({ resolved: true, outcome: "visited" });
      expect(await navigationPromptQueue.next(U2)).toBeNull();
      expect(await nav(otherUser.id)).toMatchObject({ resolved: false });
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

      await updateCheckIn(U2, first.checkin_id, { scores: { overall: 90 } });
      const after = await cafeWorkStats(dbClient, CAFE_A);
      // Two users now: U1 overall 80 (seed) and U2 90
      expect(after.n_users).toBe(2);
      expect(after.n_checkins).toBe(2);
      expect(after.experience_score).toBeCloseTo(90, 6); // U2's recency-weighted overall is 90
      expect(after.dims.overall.sum).toBe(90);
      const detail = await getCafe(CAFE_A);
      expect(detail?.work_stats.experience_score).toBe(after.experience_score);
    });

    it("edit photo deltas: add attaches + merges gallery, remove detaches from both (BRAWUKA-563)", async () => {
      const firstPhoto = randomUUID();
      const secondPhoto = randomUUID();
      await recordUploadIntent(U2, firstPhoto);
      const created = await createCheckIn(
        U2,
        { cafe_id: CAFE_A, scores: { overall: 60 }, photo_ids: [firstPhoto] },
        fakeProvisionPhotosDeps(),
      );

      // Add: the new id provisions like a create-time photo_id — StoredImage
      // derived server-side, intent consumed inside the tx, gallery merged.
      await recordUploadIntent(U2, secondPhoto);
      await updateCheckIn(
        U2,
        created.checkin_id,
        { add_photo_ids: [secondPhoto] },
        fakeProvisionPhotosDeps(),
      );
      const afterAdd = await dbClient.query("select photos from checkins where id = $1", [
        created.checkin_id,
      ]);
      expect((afterAdd.rows[0].photos as { id: string }[]).map((p) => p.id)).toEqual([
        firstPhoto,
        secondPhoto,
      ]);
      expect(afterAdd.rows[0].photos[1].source).toEqual({
        type: "checkin",
        id: created.checkin_id,
      });
      const galleryAfterAdd = await dbClient.query("select gallery from cafes where id = $1", [
        CAFE_A,
      ]);
      const galleryIds = (galleryAfterAdd.rows[0].gallery as { id: string }[]).map((p) => p.id);
      expect(galleryIds).toEqual(expect.arrayContaining([firstPhoto, secondPhoto]));
      const liveIntents = await dbClient.query(
        "select image_uuid from image_upload_intents where image_uuid = any($1::uuid[])",
        [[firstPhoto, secondPhoto]],
      );
      expect(liveIntents.rows).toHaveLength(0);

      // Remove: the photo leaves the check-in AND the gallery entry scoped
      // to this check-in's source; a foreign-source same-id entry survives.
      await updateCheckIn(U2, created.checkin_id, { remove_photo_ids: [firstPhoto] });
      const afterRemove = await dbClient.query("select photos from checkins where id = $1", [
        created.checkin_id,
      ]);
      expect((afterRemove.rows[0].photos as { id: string }[]).map((p) => p.id)).toEqual([
        secondPhoto,
      ]);
      const galleryAfterRemove = await dbClient.query("select gallery from cafes where id = $1", [
        CAFE_A,
      ]);
      const remainingIds = (galleryAfterRemove.rows[0].gallery as { id: string }[]).map(
        (p) => p.id,
      );
      expect(remainingIds).toContain(secondPhoto);
      expect(remainingIds).not.toContain(firstPhoto);

      // Idempotent retry: removing an id that is not attached is a no-op —
      // no photos SET, no gallery write.
      const before = await dbClient.query("select updated_at from checkins where id = $1", [
        created.checkin_id,
      ]);
      await updateCheckIn(U2, created.checkin_id, { remove_photo_ids: [firstPhoto] });
      const after = await dbClient.query("select updated_at from checkins where id = $1", [
        created.checkin_id,
      ]);
      expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);
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

      // Add an external photo without 'source' field to gallery to verify it is preserved (BRAWUKA-391)
      const noSourcePhoto = { id: "no-source-photo-001", card: "cover_card.webp", thumb: "thumb.webp" };
      await dbClient.query(
        `update cafes set gallery = coalesce(gallery, '[]'::jsonb) || $2::jsonb where id = $1`,
        [CAFE_A, JSON.stringify([noSourcePhoto])],
      );

      const galleryBefore = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      expect(JSON.stringify(galleryBefore.rows[0].gallery)).toContain(photoId);
      expect(JSON.stringify(galleryBefore.rows[0].gallery)).toContain("no-source-photo-001");

      await softDeleteCheckIn(U2, created.checkin_id);
      const after = await cafeWorkStats(dbClient, CAFE_A);
      expect(after.n_checkins).toBe(1);
      expect(after.n_users).toBe(1);
      // Back to seed user's contribution only
      expect(after.experience_score).toBeNull(); // seed has no overall dim, only wifi
      expect(after.dims.overall).toEqual({ sum: 0, n: 0 });
      // Deleted check-in's photos must not remain in the gallery, but photos without source must be preserved (BRAWUKA-391)
      const galleryAfter = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      expect(JSON.stringify(galleryAfter.rows[0].gallery)).not.toContain(photoId);
      expect(JSON.stringify(galleryAfter.rows[0].gallery)).toContain("no-source-photo-001");
      // Soft-deleted row still exists but is hidden from recompute
      const deletedRow = await dbClient.query("select deleted_at from checkins where id = $1", [created.checkin_id]);
      expect(deletedRow.rows[0].deleted_at).not.toBeNull();
    });

    it("soft-delete releases R2 variants for photos no live row references (BRAWUKA-433)", async () => {
      const photoA = randomUUID();
      const photoB = randomUUID();
      await recordUploadIntent(U2, photoA);
      await recordUploadIntent(U2, photoB);
      const deps = fakeProvisionPhotosDeps();
      const created = await createCheckIn(
        U2,
        { cafe_id: CAFE_A, scores: { overall: 55 }, photo_ids: [photoA, photoB] },
        deps,
      );

      // photoB is also named by a LIVE check-in (seed CHECKIN_A1): the
      // live-reference gate must keep its objects while photoA's go.
      const stored = (await dbClient.query("select photos from checkins where id = $1", [
        created.checkin_id,
      ])).rows[0].photos as { id: string }[];
      const photoBEntry = stored.find((p) => p.id === photoB);
      await dbClient.query(
        `update checkins set photos = coalesce(photos, '[]'::jsonb) || $2::jsonb where id = $1`,
        [CHECKIN_A1, JSON.stringify([photoBEntry])],
      );

      const deleted: string[] = [];
      const realDelete = deps.deleteProvisionedVariants;
      if (!realDelete) throw new Error("expected a delete dep in the fixture");
      deps.deleteProvisionedVariants = async (id) => {
        deleted.push(id);
        await realDelete(id);
      };

      await softDeleteCheckIn(U2, created.checkin_id, deps);
      expect(deleted).toEqual([photoA]);
      await expect(selectLivePhotoReferences([photoB])).resolves.toEqual([photoB]);
    });


    it("rejects edit/delete from a non-author with 403-class error", async () => {
      const inserted = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 42 } });
      await expect(updateCheckIn(U1, inserted.checkin_id, { scores: { overall: 99 } })).rejects.toBeInstanceOf(
        CheckInForbiddenError,
      );
      await expect(softDeleteCheckIn(U1, inserted.checkin_id)).rejects.toBeInstanceOf(CheckInForbiddenError);
    });

    it("recomputeAllWorkStats is idempotent and repairs drift", async () => {
      const photoId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a88";
      await recordUploadIntent(U2, photoId);
      await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 77 } }, fakeProvisionPhotosDeps());
      const goodRaw = await cafeWorkStats(dbClient, CAFE_A);
      const good = coerceWorkStats(goodRaw, appConfig.stats.dimWeights);
      // Corrupt the cached stats to the DB default
      await dbClient.query("update cafes set work_stats = '{}'::jsonb where id = $1", [CAFE_A]);
      const corruptedRaw = await cafeWorkStats(dbClient, CAFE_A);
      const corrupted = coerceWorkStats(corruptedRaw, appConfig.stats.dimWeights);
      expect(corrupted.n_users).toBe(0);
      expect(corrupted.experience_score).toBeNull();

      // Repair via the nightly entrypoint (same code the cron runs)
      await recomputeAllWorkStats(async (sql, params) => dbClient.query(sql, params));
      const repairedRaw = await cafeWorkStats(dbClient, CAFE_A);
      const repaired = coerceWorkStats(repairedRaw, appConfig.stats.dimWeights);
      const { updated_at: _goodTs, ...goodNoTs } = good;
      void _goodTs;
      const { updated_at: _repTs, ...repairedNoTs } = repaired;
      void _repTs;
      expect(repairedNoTs).toEqual(goodNoTs);

      // Second run is a no-op (idempotent) — same dims/scores, new timestamp only
      await recomputeAllWorkStats(async (sql, params) => dbClient.query(sql, params));
      const repaired2Raw = await cafeWorkStats(dbClient, CAFE_A);
      const repaired2 = coerceWorkStats(repaired2Raw, appConfig.stats.dimWeights);
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
        if (!page.next_cursor) break;
        expect(page.checkins).toHaveLength(PAGE_SIZE);
        cursor = page.next_cursor;
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
      expect(page.next_cursor).toBeNull();
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

    it("owned_by_viewer marks only the author's own rows, never leaking user_id", async () => {
      await seedFeedCheckins(1); // authored by U1, like the CHECKIN_A1 baseline
      const asAuthor = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: U1,
      });
      expect(asAuthor.checkins).toHaveLength(2);
      expect(asAuthor.checkins.every((c) => c.owned_by_viewer === true)).toBe(true);
      const asOther = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: U2,
      });
      expect(asOther.checkins.every((c) => c.owned_by_viewer === false)).toBe(true);
      const anonymous = await listPublicCheckIns({
        cafeId: CAFE_A,
        mode: "newest",
        viewerId: null,
      });
      expect(anonymous.checkins.every((c) => c.owned_by_viewer === false)).toBe(true);
      // DG13: ownership is a boolean — the author's id appears nowhere in the DTO.
      for (const c of asAuthor.checkins) {
        expect(c).not.toHaveProperty("user_id");
        expect(JSON.stringify(c)).not.toContain(U1);
      }
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

  describeDb("public author identity reads (#139 Stage 2)", () => {
    /** getCafe narrowed for the public projection (asserts the seed row exists). */
    async function publicDetail(id: string) {
      const cafe = await getCafe(id);
      expect(cafe).not.toBeNull();
      return toPublicCafeDetail(cafe as CafeDetailWithAuthor);
    }

    function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
      if (Array.isArray(value)) {
        for (const item of value) collectKeys(item, keys);
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          keys.add(k);
          collectKeys(v, keys);
        }
      }
      return keys;
    }

    it("defaults to author:null on cafe detail and both feed modes", async () => {
      expect((await publicDetail(CAFE_A)).author).toBeNull();
      for (const mode of ["newest", "helpful"] as const) {
        const page = await listPublicCheckIns({ cafeId: CAFE_A, mode, viewerId: null });
        expect(page.checkins.length).toBeGreaterThan(0);
        for (const c of page.checkins) expect(c.author).toBeNull();
      }
    });

    it("opt-in surfaces the consented author on cafe detail and feed", async () => {
      await dbClient.query(
        "update profiles set display_name = 'Nomad One', avatar_url = 'https://img.example/a.webp' where id = $1",
        [U1],
      );
      const dto = await updateProfileIdentity(U1, { showPublicIdentity: true });
      expect(dto.showPublicIdentity).toBe(true);
      expect(dto.publicHandle).toMatch(/^[a-z0-9][a-z0-9_-]{2,29}$/);

      const expected = {
        handle: dto.publicHandle,
        display_name: "Nomad One",
        avatar_url: "https://img.example/a.webp",
      };
      expect((await publicDetail(CAFE_A)).author).toEqual(expected);
      for (const mode of ["newest", "helpful"] as const) {
        const page = await listPublicCheckIns({ cafeId: CAFE_A, mode, viewerId: null });
        expect(page.checkins.find((c) => c.id === CHECKIN_A1)?.author).toEqual(expected);
      }
    });

    it("revocation restores author:null with all content intact (no deletion)", async () => {
      await updateProfileIdentity(U1, { showPublicIdentity: true });
      const before = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
      expect(before.checkins.find((c) => c.id === CHECKIN_A1)?.author).not.toBeNull();

      const revoked = await updateProfileIdentity(U1, { showPublicIdentity: false });
      expect(revoked.showPublicIdentity).toBe(false);

      expect((await publicDetail(CAFE_A)).author).toBeNull();
      const after = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
      const row = after.checkins.find((c) => c.id === CHECKIN_A1);
      expect(row).toBeDefined();
      expect(row?.author).toBeNull();
      // Content untouched: handle stays reserved, consent timestamp cleared.
      const kept = await dbClient.query(
        "select public_handle, identity_consented_at from profiles where id = $1",
        [U1],
      );
      expect(kept.rows[0].public_handle).not.toBeNull();
      expect(kept.rows[0].identity_consented_at).toBeNull();
    });

    it("service-account and null created_by cafes keep author:null + maintained_by_service marker", async () => {
      // Even an opted-in service-account profile must never render as author.
      await dbClient.query(
        "update profiles set show_public_identity = true, public_handle = 'coffeemode' where id = $1",
        [SERVICE_ACCOUNT_ID],
      );
      for (const createdBy of [SERVICE_ACCOUNT_ID, null]) {
        await dbClient.query("update cafes set created_by = $1 where id = $2", [createdBy, CAFE_A]);
        const pub = await publicDetail(CAFE_A);
        expect(pub.author).toBeNull();
        expect(pub.maintained_by_service).toBe(true);
        expect(pub).not.toHaveProperty("created_by");
      }
    });

    it("public DTOs expose no internal UUID and no user_id/by keys", async () => {
      await dbClient.query("update profiles set display_name = 'Nomad One' where id = $1", [U1]);
      await updateProfileIdentity(U1, { showPublicIdentity: true });
      // Stored photo attribution still carries the internal id — the public
      // projection must strip it.
      const photoCheckin = randomUUID();
      await dbClient.query(
        "insert into checkins (id, cafe_id, user_id, scores, photos) values ($1, $2, $3, '{}'::jsonb, $4::jsonb)",
        [
          photoCheckin,
          CAFE_A,
          U1,
          JSON.stringify([
            {
              id: "img-x",
              original: "original/img-x.webp",
              card: "card/img-x.webp",
              thumbnail: "thumbnail/img-x.webp",
              w: 1,
              h: 1,
              by: U1,
              at: "2026-08-01T10:00:00.000Z",
            },
          ]),
        ],
      );
      const pub = await publicDetail(CAFE_A);
      const page = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
      const payload = JSON.stringify({ cafe: pub, feed: page });
      // Internal author UUIDs never appear (cafe/check-in resource ids are public by design).
      for (const internalId of [U1, U2, SERVICE_ACCOUNT_ID]) {
        expect(payload).not.toContain(internalId);
      }
      const keys = collectKeys({ cafe: pub, feed: page });
      for (const banned of ["user_id", "by", "created_by"]) {
        expect(keys.has(banned)).toBe(false);
      }
      // The opted-in author is present but carries only public-safe fields.
      expect(pub.author).toEqual({
        handle: expect.any(String),
        display_name: "Nomad One",
        avatar_url: null,
      });
      expect(page.checkins.find((c) => c.id === photoCheckin)?.author).toEqual(pub.author);
    });
  });


  describeDb("seo-sharing queries — sitemap lastmod + gone-cafe location (#150)", () => {
    it("sitemap lastmod prefers work_stats.updated_at, falls back to cafes.updated_at", async () => {
      // '{}' work_stats = legacy/seeded row with no aggregate timestamp —
      // the row's updated_at applies (the seed now writes real stats, so
      // clear it to keep exercising the fallback branch).
      await dbClient.query("update cafes set work_stats = '{}'::jsonb where id = $1", [CAFE_A]);
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

    it("getCafeLocation returns coordinates for live and tombstoned rows, null otherwise", async () => {
      // Seed point is ST_MakePoint(lng=103.8, lat=1.35).
      await expect(getCafeLocation(CAFE_A)).resolves.toEqual({ lat: 1.35, lng: 103.8 });

      // Grandfathered tombstone row: tombstone coordinates remain accessible for 404 recovery
      await dbClient.query("update cafes set deleted_at = now() where id = $1", [CAFE_A]);
      await expect(getCafeLocation(CAFE_A)).resolves.toEqual({ lat: 1.35, lng: 103.8 });

      // Live queries and write paths exclude the tombstoned cafe
      await expect(getCafe(CAFE_A)).resolves.toBeNull();
      const nearby = await listCafesNearby({ lat: 1.35, lng: 103.8, radiusKm: 10, limit: 10 });
      expect(nearby.some((c) => c.id === CAFE_A)).toBe(false);
      const sitemap = await listCafeSitemapEntries();
      expect(sitemap.some((c) => c.id === CAFE_A)).toBe(false);
      const search = await searchCafesInDb({ q: "Cafe" });
      expect(search.some((c) => c.id === CAFE_A)).toBe(false);

      // Write paths reject targeting a tombstoned cafe
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

      // Restore CAFE_A
      await dbClient.query("update cafes set deleted_at = null where id = $1", [CAFE_A]);
    });

    it("recomputeAllWorkStats skips tombstoned cafes", async () => {
      await dbClient.query("update cafes set deleted_at = now() where id = $1", [CAFE_A]);
      await expect(recomputeAllWorkStats(dbClient.query.bind(dbClient))).resolves.toBeUndefined();
      expect(await getCafe(CAFE_A)).toBeNull();
      await dbClient.query("update cafes set deleted_at = null where id = $1", [CAFE_A]);
    });
  });

  describeDb("deleteCafe checkin-scoped delete & community handoff (DG125 / #229)", () => {
    it("sole-owner delete turns cafe into public empty shell, excludes from sitemap, and blocks re-POSTing same POI with 409", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Sole Owner Cafe",
          lat: 1.35,
          lng: 103.8,
          google_place_id: "ChIJ_sole_owner_test",
          checkin: { scores: { wifi: 85, overall: 85 }, max_stay: "unlimited", note: "mine", photo_ids: [photoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      // Before delete: sitemap includes the cafe
      const sitemapBefore = await listCafeSitemapEntries();
      expect(sitemapBefore.some((c) => c.id === created.cafe_id)).toBe(true);

      // Delete as sole owner
      const result = await deleteCafe(created.cafe_id, U1);
      expect(result).toEqual({
        ok: true,
        id: created.cafe_id,
        removed_checkins: 1,
        owner_transferred: false,
        shell: true,
      });

      // Cafe row remains live in DB (never deleted)
      const cafeRow = await dbClient.query("select * from cafes where id = $1", [created.cafe_id]);
      expect(cafeRow.rows[0].deleted_at).toBeNull();
      expect(cafeRow.rows[0].created_by).toBe(U1);

      // Cafe detail remains public and readable as an empty shell
      const detail = await getCafe(created.cafe_id);
      expect(detail).not.toBeNull();
      expect(detail?.work_stats.n_checkins).toBe(0);
      expect(detail?.gallery).toEqual([]);

      // Excluded from sitemap because n_checkins = 0
      const sitemapAfter = await listCafeSitemapEntries();
      expect(sitemapAfter.some((c) => c.id === created.cafe_id)).toBe(false);

      // Re-POSTing with same google_place_id collides on unique index -> 409 CafeExistsError
      const newPhotoId = randomUUID();
      await recordUploadIntent(U1, newPhotoId);
      await expect(
        createCafeWithFirstCheckIn(
          U1,
          {
            name: "Duplicate Place Cafe",
            lat: 1.35,
            lng: 103.8,
            google_place_id: "ChIJ_sole_owner_test",
            checkin: { scores: { wifi: 90, overall: 90 }, max_stay: "unlimited", note: "dup", photo_ids: [newPhotoId] },
          },
          fakeProvisionPhotosDeps(),
        ),
      ).rejects.toBeInstanceOf(CafeExistsError);

      // Repeat delete on own shell (0 own live checkins left) -> CafeNotFoundError (404)
      await expect(deleteCafe(created.cafe_id, U1)).rejects.toBeInstanceOf(CafeNotFoundError);
    });

    it("sole-owner delete releases R2 variants for the removed check-ins' photos (BRAWUKA-433)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const deps = fakeProvisionPhotosDeps();
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Photo Cleanup Cafe",
          lat: 1.35,
          lng: 103.8,
          checkin: { scores: { overall: 80 }, max_stay: "unlimited", note: "photo cleanup", photo_ids: [photoId] },
        },
        deps,
      );

      const deleted: string[] = [];
      const realDelete = deps.deleteProvisionedVariants;
      if (!realDelete) throw new Error("expected a delete dep in the fixture");
      deps.deleteProvisionedVariants = async (id) => {
        deleted.push(id);
        await realDelete(id);
      };

      const result = await deleteCafe(created.cafe_id, U1, undefined, deps);
      expect(result.removed_checkins).toBe(1);
      expect(deleted).toEqual([photoId]);
    });


    it("community cafe without confirm rejects with 409 (cafe_has_other_checkins) and 0 mutations", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Community Cafe No Confirm",
          lat: 1.35,
          lng: 103.8,
          checkin: { scores: { wifi: 80, overall: 80 }, max_stay: "unlimited", note: "creator", photo_ids: [photoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      // U2 checks in
      await createCheckIn(U2, { cafe_id: created.cafe_id, scores: { wifi: 90 } });

      // U1 attempts delete without confirm
      const err = await deleteCafe(created.cafe_id, U1, { confirm: false }).catch((e) => e);
      expect(err).toBeInstanceOf(CafeHasOtherCheckinsError);
      expect((err as CafeHasOtherCheckinsError).n).toBe(1);

      // Zero mutations: both checkins live, created_by still U1, work_stats has 2 checkins
      const cafe = await getCafe(created.cafe_id);
      expect(cafe?.work_stats.n_checkins).toBe(2);
      const cafeRow = await dbClient.query("select created_by from cafes where id = $1", [created.cafe_id]);
      expect(cafeRow.rows[0].created_by).toBe(U1);
      const checkins = await dbClient.query(
        "select id, user_id, deleted_at from checkins where cafe_id = $1 order by visited_at",
        [created.cafe_id],
      );
      expect(checkins.rows).toHaveLength(2);
      expect(checkins.rows[0].deleted_at).toBeNull();
      expect(checkins.rows[1].deleted_at).toBeNull();
    });

    it("community cafe with confirm deletes creator checkins, keeps others, transfers created_by to service account, and drops from profile", async () => {
      const photoId1 = randomUUID();
      await recordUploadIntent(U1, photoId1);
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Community Cafe Confirmed",
          lat: 1.35,
          lng: 103.8,
          checkin: { scores: { wifi: 75, overall: 75 }, max_stay: "unlimited", note: "u1 checkin 1", photo_ids: [photoId1] },
        },
        fakeProvisionPhotosDeps(),
      );

      // DG64: U1's fused creation check-in is still live, so age it past the
      // revisit window — this test covers delete flows, not the window.
      await dbClient.query("update checkins set visited_at = now() - interval '25 hours' where id = $1", [
        created.checkin_id,
      ]);

      // U1 adds a 2nd checkin
      await createCheckIn(U1, { cafe_id: created.cafe_id, scores: { wifi: 80 } });

      // U2 adds a checkin with photo
      const photoId2 = randomUUID();
      await recordUploadIntent(U2, photoId2);
      await createCheckIn(
        U2,
        { cafe_id: created.cafe_id, scores: { wifi: 95 }, photo_ids: [photoId2] },
        fakeProvisionPhotosDeps(),
      );

      // Check U1 profile cafes contains the cafe
      const u1CafesBefore = await getUserCafes(U1);
      expect(u1CafesBefore.items.some((c) => c.id === created.cafe_id)).toBe(true);

      // U1 deletes with confirm: true
      const result = await deleteCafe(created.cafe_id, U1, { confirm: true });
      expect(result).toEqual({
        ok: true,
        id: created.cafe_id,
        removed_checkins: 2,
        owner_transferred: true,
        shell: false,
      });

      // U1 checkins soft-deleted, U2 checkin intact
      const checkins = await dbClient.query(
        "select id, user_id, deleted_at from checkins where cafe_id = $1 order by user_id",
        [created.cafe_id],
      );
      const u1Rows = checkins.rows.filter((r) => r.user_id === U1);
      const u2Rows = checkins.rows.filter((r) => r.user_id === U2);
      expect(u1Rows).toHaveLength(2);
      expect(u1Rows.every((r) => r.deleted_at !== null)).toBe(true);
      expect(u2Rows).toHaveLength(1);
      expect(u2Rows[0].deleted_at).toBeNull();

      // created_by transferred to service account
      const cafe = await getCafe(created.cafe_id);
      const cafeRow = await dbClient.query("select created_by from cafes where id = $1", [created.cafe_id]);
      expect(cafeRow.rows[0].created_by).toBe("00000000-0000-4000-a000-000000000001");
      expect(cafe?.work_stats.n_checkins).toBe(1);
      // Gallery retained U2's photo and dropped U1's
      expect(cafe?.gallery).toHaveLength(1);

      // Cafe drops out of U1's profile cafes
      const u1CafesAfter = await getUserCafes(U1);
      expect(u1CafesAfter.items.some((c) => c.id === created.cafe_id)).toBe(false);

      // Repeat delete by U1 rejects with 403 (no longer creator)
      await expect(deleteCafe(created.cafe_id, U1)).rejects.toBeInstanceOf(CafeForbiddenError);
    });

    it("community cafe where creator already soft-deleted checkin individually transfers ownership on confirm", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Individual Soft-Deleted First Cafe",
          lat: 1.35,
          lng: 103.8,
          checkin: { scores: { wifi: 70, overall: 70 }, max_stay: "unlimited", note: "u1 first", photo_ids: [photoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      // U2 checks in
      await createCheckIn(U2, { cafe_id: created.cafe_id, scores: { wifi: 85 } });

      // U1 soft-deletes their check-in individually via softDeleteCheckIn
      await softDeleteCheckIn(U1, created.checkin_id);

      // U1 attempts deleteCafe without confirm -> 403
      await expect(deleteCafe(created.cafe_id, U1, { confirm: false })).rejects.toBeInstanceOf(CafeHasOtherCheckinsError);

      // U1 calls deleteCafe with confirm: true -> 200 with removed_checkins = 0 and owner_transferred = true
      const result = await deleteCafe(created.cafe_id, U1, { confirm: true });
      expect(result).toEqual({
        ok: true,
        id: created.cafe_id,
        removed_checkins: 0,
        owner_transferred: true,
        shell: false,
      });

      const cafeRow = await dbClient.query("select created_by from cafes where id = $1", [created.cafe_id]);
      expect(cafeRow.rows[0].created_by).toBe("00000000-0000-4000-a000-000000000001");
    });

    it("concurrent double-delete has exactly one winner", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Concurrent Delete Cafe",
          lat: 1.35,
          lng: 103.8,
          checkin: { scores: { wifi: 80, overall: 80 }, max_stay: "unlimited", note: "race", photo_ids: [photoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      const [res1, res2] = await Promise.allSettled([
        deleteCafe(created.cafe_id, U1),
        deleteCafe(created.cafe_id, U1),
      ]);

      const successes = [res1, res2].filter((r) => r.status === "fulfilled");
      const failures = [res1, res2].filter((r) => r.status === "rejected");

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect((failures[0] as PromiseRejectedResult).reason).toBeInstanceOf(CafeNotFoundError);
    });

    it("rejects delete on null created_by with CafeForbiddenError", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Null Creator Cafe",
          lat: 1.35,
          lng: 103.8,
          checkin: { scores: { wifi: 80, overall: 80 }, max_stay: "unlimited", note: "null", photo_ids: [photoId] },
        },
        fakeProvisionPhotosDeps(),
      );

      await dbClient.query("update cafes set created_by = null where id = $1", [created.cafe_id]);
      await expect(deleteCafe(created.cafe_id, U1)).rejects.toBeInstanceOf(CafeForbiddenError);
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

    it("filters cafes by work dimensions pushed down to SQL", async () => {
      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: "Zeta Work Hub",
          lat: 1.35,
          lng: 103.8,
          city: "singapore",
          checkin: {
            scores: { overall: 90, wifi: 85, outlets: 80, seats: 75, temp: 70, coffee: 65 },
            max_stay: "unlimited",
            note: "nice",
            photo_ids: [],
          },
        },
        fakeProvisionPhotosDeps(),
      );

      const wifiMatch = await searchCafesInDb({ filter_wifi: 80 });
      expect(wifiMatch.some((c) => c.id === created.cafe_id)).toBe(true);

      const wifiHigh = await searchCafesInDb({ filter_wifi: 95 });
      expect(wifiHigh.some((c) => c.id === created.cafe_id)).toBe(false);

      const outletsMatch = await searchCafesInDb({ filter_outlets: 75 });
      expect(outletsMatch.some((c) => c.id === created.cafe_id)).toBe(true);

      const seatsMatch = await searchCafesInDb({ filter_seats: 70 });
      expect(seatsMatch.some((c) => c.id === created.cafe_id)).toBe(true);

      const tempMatch = await searchCafesInDb({ filter_temp: 65 });
      expect(tempMatch.some((c) => c.id === created.cafe_id)).toBe(true);

      const coffeeMatch = await searchCafesInDb({ filter_coffee: 60 });
      expect(coffeeMatch.some((c) => c.id === created.cafe_id)).toBe(true);

      const overallMatch = await searchCafesInDb({ filter_overall: 85 });
      expect(overallMatch.some((c) => c.id === created.cafe_id)).toBe(true);

      const overallHigh = await searchCafesInDb({ filter_overall: 95 });
      expect(overallHigh.some((c) => c.id === created.cafe_id)).toBe(false);
    });

    it("filters cafes by overall score using dims.overall fallback when experience_score is missing (#274)", async () => {
      const legacyCafeId = randomUUID();
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz, work_stats)
         values ($1, 'Legacy Cafe', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography,
                 'singapore', $2, 'Asia/Singapore', $3::jsonb)`,
        [
          legacyCafeId,
          U1,
          JSON.stringify({
            dims: { overall: { sum: 180, n: 2 } },
          }),
        ],
      );

      const match = await searchCafesInDb({ filter_overall: 85 });
      expect(match.some((c) => c.id === legacyCafeId)).toBe(true);

      const high = await searchCafesInDb({ filter_overall: 95 });
      expect(high.some((c) => c.id === legacyCafeId)).toBe(false);
    });

    it("filters cafes by max_stay pushed down to SQL without dropping matches beyond the 100 fetch cap (#272)", async () => {
      const city = "stay-cap-city";
      const insertValues: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      // 105 non-matching cafes (max_stay: "1h") named Alpha...
      for (let i = 0; i < 105; i++) {
        const id = randomUUID();
        const name = `Alpha Stay ${i.toString().padStart(3, "0")}`;
        insertValues.push(
          `($${paramIdx++}, $${paramIdx++}, ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, $${paramIdx++}, $${paramIdx++}, 'Asia/Singapore', $${paramIdx++}::jsonb)`,
        );
        params.push(id, name, city, U1, JSON.stringify({ policies: { max_stay: { "1h": 5 } } }));
      }

      // 15 matching cafes (max_stay: "unlimited") named Zulu... (sort alphabetically after all 105 Alpha cafes)
      const matchingIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        const id = randomUUID();
        matchingIds.push(id);
        const name = `Zulu Stay ${i.toString().padStart(3, "0")}`;
        insertValues.push(
          `($${paramIdx++}, $${paramIdx++}, ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, $${paramIdx++}, $${paramIdx++}, 'Asia/Singapore', $${paramIdx++}::jsonb)`,
        );
        params.push(id, name, city, U1, JSON.stringify({ policies: { max_stay: { unlimited: 5 } } }));
      }

      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz, work_stats) values ${insertValues.join(", ")}`,
        params,
      );

      // Search with filter_max_stay: "2h" (matches "unlimited", but not "1h")
      // Without SQL pushdown, LIMIT 100 on alphabetical sort would truncate before the Zulu cafes, returning 0 rows.
      const results = await searchCafesInDb({ city, filter_max_stay: "2h" });
      expect(results).toHaveLength(15);
      expect(results.map((c) => c.id).sort()).toEqual(matchingIds.sort());
      expect(results.every((c) => c.name.startsWith("Zulu Stay"))).toBe(true);
    });

    it("iteratively fetches open cafes on real Postgres without dropping matches beyond the 100 fetch cap (#272)", async () => {
      const city = "open-cap-city";
      const alwaysOpenHours = JSON.stringify({
        mon: { open: "00:00", close: "23:59" },
        tue: { open: "00:00", close: "23:59" },
        wed: { open: "00:00", close: "23:59" },
        thu: { open: "00:00", close: "23:59" },
        fri: { open: "00:00", close: "23:59" },
        sat: { open: "00:00", close: "23:59" },
        sun: { open: "00:00", close: "23:59" },
      });

      const insertValues: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      // 105 closed cafes (opening_hours: null) named Alpha...
      for (let i = 0; i < 105; i++) {
        const id = randomUUID();
        const name = `Alpha Closed ${i.toString().padStart(3, "0")}`;
        insertValues.push(
          `($${paramIdx++}, $${paramIdx++}, ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, $${paramIdx++}, $${paramIdx++}, 'Asia/Singapore', null)`,
        );
        params.push(id, name, city, U1);
      }

      // 15 open cafes named Zulu... (sort alphabetically after all 105 Alpha cafes)
      for (let i = 0; i < 15; i++) {
        const id = randomUUID();
        const name = `Zulu Open ${i.toString().padStart(3, "0")}`;
        insertValues.push(
          `($${paramIdx++}, $${paramIdx++}, ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, $${paramIdx++}, $${paramIdx++}, 'Asia/Singapore', $${paramIdx++}::jsonb)`,
        );
        params.push(id, name, city, U1, alwaysOpenHours);
      }

      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz, opening_hours) values ${insertValues.join(", ")}`,
        params,
      );

      // executeSearch with open_now: true — DG145-C pushdown: the SQL
      // predicate filters the 105 closed Alpha rows inside the query, so the
      // 15 Zulu matches are no longer truncated by the 100-row fetch cap.
      const searchRes = await executeSearch(
        { city, open_now: true },
        new Date("2026-08-29T10:00:00Z"),
      );

      expect(searchRes.results.length).toBe(10);
      expect(searchRes.results.every((r) => r.name.startsWith("Zulu Open"))).toBe(true);
      expect(searchRes.is_weak_results).toBe(false);
      expect(searchRes.total_count).toBe(15);
    });
  });

  describeDb("open_now SQL pushdown — cafe_is_open_at parity with isOpenAt (DG145-C / BRAWUKA-25)", () => {
    // Every edge-case hours shape the contract names, seeded once. The
    // parity check runs the real SQL predicate (via searchCafesInDb) against
    // the JS isOpenAt oracle across a matrix of instants — including DST
    // boundaries, overnight spillover, close === open (24h), explicit-null
    // days, missing/invalid hours, and invalid tz.
    const PARITY_CITY = "parity-city";
    const parityIds: Record<string, string> = {};

    const PARITY_FIXTURES: Array<{ key: string; tz: string | null; hours: unknown }> = [
      // close === open on every day → around the clock.
      { key: "always24", tz: "Asia/Singapore", hours: {
        mon: { open: "00:00", close: "00:00" }, tue: { open: "00:00", close: "00:00" },
        wed: { open: "00:00", close: "00:00" }, thu: { open: "00:00", close: "00:00" },
        fri: { open: "00:00", close: "00:00" }, sat: { open: "00:00", close: "00:00" },
        sun: { open: "00:00", close: "00:00" } } },
      // close === open at a non-midnight anchor — still 24h.
      { key: "always24Offset", tz: "Asia/Singapore", hours: {
        mon: { open: "09:00", close: "09:00" }, tue: { open: "09:00", close: "09:00" },
        wed: { open: "09:00", close: "09:00" }, thu: { open: "09:00", close: "09:00" },
        fri: { open: "09:00", close: "09:00" }, sat: { open: "09:00", close: "09:00" },
        sun: { open: "09:00", close: "09:00" } } },
      // Single-day 24h window (BRAWUKA-571): Monday 09:00-09:00 reads open
      // around the clock all Monday, including before the 09:00 anchor.
      // Sunday has no entry, so yesterday's spillover cannot mask a miss.
      { key: "singleDay24", tz: "Asia/Singapore", hours: {
        mon: { open: "09:00", close: "09:00" },
        tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
      // Overnight window 22:00–04:00 every day.
      { key: "overnight", tz: "Asia/Singapore", hours: {
        mon: { open: "22:00", close: "04:00" }, tue: { open: "22:00", close: "04:00" },
        wed: { open: "22:00", close: "04:00" }, thu: { open: "22:00", close: "04:00" },
        fri: { open: "22:00", close: "04:00" }, sat: { open: "22:00", close: "04:00" },
        sun: { open: "22:00", close: "04:00" } } },
      // Overnight only on Sunday — Monday spillover is the only open window.
      { key: "sunOvernight", tz: "Asia/Singapore", hours: {
        sun: { open: "22:00", close: "04:00" },
        mon: null, tue: null, wed: null, thu: null, fri: null, sat: null } },
      // Plain daytime window.
      { key: "daytime", tz: "Asia/Singapore", hours: {
        mon: { open: "09:00", close: "18:00" }, tue: { open: "09:00", close: "18:00" },
        wed: { open: "09:00", close: "18:00" }, thu: { open: "09:00", close: "18:00" },
        fri: { open: "09:00", close: "18:00" }, sat: { open: "09:00", close: "18:00" },
        sun: { open: "09:00", close: "18:00" } } },
      // Explicit-null days mixed with real windows.
      { key: "nullDays", tz: "Asia/Singapore", hours: {
        mon: { open: "09:00", close: "18:00" }, tue: null, wed: null,
        thu: { open: "09:00", close: "18:00" }, fri: null, sat: null, sun: null } },
      // Missing hours entirely.
      { key: "noHours", tz: "Asia/Singapore", hours: null },
      // Corrupt day entry (unparseable close) — must exclude, never error.
      { key: "corruptClose", tz: "Asia/Singapore", hours: {
        mon: { open: "09:00", close: "25:99" }, tue: { open: "09:00", close: "18:00" },
        wed: { open: "09:00", close: "18:00" }, thu: { open: "09:00", close: "18:00" },
        fri: { open: "09:00", close: "18:00" }, sat: { open: "09:00", close: "18:00" },
        sun: { open: "09:00", close: "18:00" } } },
      // Corrupt shape: day entry is a string, not an object.
      { key: "corruptShape", tz: "Asia/Singapore", hours: { mon: "09:00-18:00" } },
      // Invalid IANA tz — must exclude, never error the query.
      { key: "badTz", tz: "Not/A_Real_Zone", hours: {
        mon: { open: "00:00", close: "00:00" }, tue: { open: "00:00", close: "00:00" },
        wed: { open: "00:00", close: "00:00" }, thu: { open: "00:00", close: "00:00" },
        fri: { open: "00:00", close: "00:00" }, sat: { open: "00:00", close: "00:00" },
        sun: { open: "00:00", close: "00:00" } } },
      // Missing tz.
      { key: "noTz", tz: null, hours: {
        mon: { open: "00:00", close: "00:00" }, tue: { open: "00:00", close: "00:00" },
        wed: { open: "00:00", close: "00:00" }, thu: { open: "00:00", close: "00:00" },
        fri: { open: "00:00", close: "00:00" }, sat: { open: "00:00", close: "00:00" },
        sun: { open: "00:00", close: "00:00" } } },
      // DST-boundary cafe: Berlin 09:00–18:00. The same UTC instant lands on
      // different local times across the 2026-03-29 spring-forward.
      { key: "berlinDst", tz: "Europe/Berlin", hours: {
        mon: { open: "09:00", close: "18:00" }, tue: { open: "09:00", close: "18:00" },
        wed: { open: "09:00", close: "18:00" }, thu: { open: "09:00", close: "18:00" },
        fri: { open: "09:00", close: "18:00" }, sat: { open: "09:00", close: "18:00" },
        sun: { open: "09:00", close: "18:00" } } },
      // Sunday-only daytime window — boundary of the weekly wraparound.
      { key: "sunOnly", tz: "Asia/Singapore", hours: {
        sun: { open: "10:00", close: "14:00" },
        mon: null, tue: null, wed: null, thu: null, fri: null, sat: null } },
    ];

    // Instants spanning: weekday/weekend, inside/outside windows, overnight
    // spillover minutes, and the Berlin spring-forward/fall-back edges.
    const PARITY_INSTANTS = [
      "2026-09-07T00:30:00Z", // Mon 08:30 SGT
      "2026-09-07T01:00:00Z", // Mon 09:00 SGT — window open edge
      "2026-09-07T10:00:00Z", // Mon 18:00 SGT — window close edge
      "2026-09-07T14:00:00Z", // Mon 22:00 SGT — overnight open edge
      "2026-09-07T19:30:00Z", // Tue 03:30 SGT — overnight spillover
      "2026-09-07T20:00:00Z", // Tue 04:00 SGT — spillover close edge
      "2026-09-13T16:30:00Z", // Sun 00:30 SGT
      "2026-09-13T02:00:00Z", // Sun 10:00 SGT — sunOnly open edge
      "2026-09-13T06:00:00Z", // Sun 14:00 SGT — sunOnly close edge
      "2026-03-29T00:30:00Z", // Sun 01:30 CET (pre-spring-forward)
      "2026-03-29T01:30:00Z", // Sun 03:30 CEST (post-spring-forward)
      "2026-03-30T06:30:00Z", // Mon 08:30 CEST — closed
      "2026-03-30T07:30:00Z", // Mon 09:30 CEST — open
      "2026-10-25T00:30:00Z", // Sun 02:30 CEST (ambiguous fall-back hour)
      "2026-10-25T01:30:00Z", // Sun 02:30 CET (second occurrence)
      "2026-10-26T07:30:00Z", // Mon 08:30 CET — closed
      "2026-10-26T08:30:00Z", // Mon 09:30 CET — open
    ];

    // The outer beforeEach truncates cafes, so fixtures must be re-seeded
    // per test (beforeEach, not beforeAll).
    beforeEach(async () => {
      const insertValues: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      for (const f of PARITY_FIXTURES) {
        const id = randomUUID();
        parityIds[f.key] = id;
        insertValues.push(
          `($${paramIdx++}, $${paramIdx++}, ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}::jsonb)`,
        );
        params.push(
          id,
          `Parity ${f.key}`,
          PARITY_CITY,
          U1,
          f.tz,
          f.hours === null ? null : JSON.stringify(f.hours),
        );
      }
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz, opening_hours) values ${insertValues.join(", ")}`,
        params,
      );
    });

    it("matches isOpenAt for every fixture x instant", async () => {
      for (const iso of PARITY_INSTANTS) {
        const instant = new Date(iso);
        const rows = await searchCafesInDb({
          city: PARITY_CITY,
          open_now: true,
          instant,
          limit: 500,
        });
        const sqlOpen = new Set(rows.map((r) => r.id));

        for (const f of PARITY_FIXTURES) {
          const expected =
            isOpenAt(
              f.hours as Parameters<typeof isOpenAt>[0],
              f.tz,
              instant,
            ) === true;
          const actual = sqlOpen.has(parityIds[f.key]);
          expect(
            actual,
            `${f.key} @ ${iso}: SQL=${actual} JS=${expected}`,
          ).toBe(expected);
        }
      }
    });

    it("excludes invalid tz and corrupt hours without erroring the query", async () => {
      const rows = await searchCafesInDb({
        city: PARITY_CITY,
        open_now: true,
        instant: new Date("2026-09-07T01:00:00Z"), // Mon 09:00 SGT — daytime open
        limit: 500,
      });
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(parityIds.badTz)).toBe(false);
      expect(ids.has(parityIds.noTz)).toBe(false);
      expect(ids.has(parityIds.corruptClose)).toBe(false);
      expect(ids.has(parityIds.corruptShape)).toBe(false);
      expect(ids.has(parityIds.noHours)).toBe(false);
      expect(ids.has(parityIds.daytime)).toBe(true);
      expect(ids.has(parityIds.always24)).toBe(true);
      expect(ids.has(parityIds.always24Offset)).toBe(true);
      expect(ids.has(parityIds.singleDay24)).toBe(true);
    });

    it("gives a single-day 24h window no overnight tail the next morning (BRAWUKA-571)", async () => {
      const rows = await searchCafesInDb({
        city: PARITY_CITY,
        open_now: true,
        instant: new Date("2026-09-07T19:30:00Z"), // Tue 03:30 SGT — spillover hour
        limit: 500,
      });
      const ids = new Set(rows.map((r) => r.id));
      expect(ids.has(parityIds.singleDay24)).toBe(false);
      expect(ids.has(parityIds.always24Offset)).toBe(true);
      expect(ids.has(parityIds.overnight)).toBe(true);
    });

    it("cafesDataVersion moves when a cafe row is written", async () => {
      const before = await cafesDataVersion();
      await dbClient.query(
        `update cafes set updated_at = now() where id = $1`,
        [parityIds.daytime],
      );
      const after = await cafesDataVersion();
      expect(before).not.toBeNull();
      expect(after).not.toBe(before);
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
      expect(checkinsResult.items[0]?.cafe_id).toBe(CAFE_A);

      const cafesResult = await getUserCafes(U1, { limit: 10 });
      expect(cafesResult.items.length).toBeGreaterThanOrEqual(1);
      expect(cafesResult.items[0]?.id).toBe(CAFE_A);
      expect(cafesResult.items[0]?.is_creation).toBe(true);
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

      await dbClient.query("update cafes set deleted_at = now() where id = $1", [CAFE_B]);
      // cafesCount excludes soft-deleted cafe; checkinsCount still counts checkins
      const afterStats = await getUserStats(U1);
      expect(afterStats.cafesCount).toBe(1);
      expect(afterStats.checkinsCount).toBe(2);

      // getUserCheckIns returns cafeIsDeleted = true for deleted cafe
      const checkins = await getUserCheckIns(U1);
      const bCheckin = checkins.items.find((i) => i.id === CHECKIN_B1);
      expect(bCheckin?.cafe_is_deleted).toBe(true);
      const aCheckin = checkins.items.find((i) => i.id === CHECKIN_A1);
      expect(aCheckin?.cafe_is_deleted).toBe(false);

      // getUserCafes completely excludes soft-deleted cafe
      const userCafes = await getUserCafes(U1);
      expect(userCafes.items.some((c) => c.id === CAFE_B)).toBe(false);
      expect(userCafes.items.some((c) => c.id === CAFE_A)).toBe(true);
    });

    it("check-in creation rejects attaching to a soft-deleted cafe on real Postgres (issue #219)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      await dbClient.query("update cafes set deleted_at = now() where id = $1", [CAFE_A]);

      await expect(
        createCheckIn(
          U1,
          { cafe_id: CAFE_A, scores: { overall: 80 }, photo_ids: [photoId] },
          fakeProvisionPhotosDeps(),
        ),
      ).rejects.toThrow(CafeNotFoundError);
    });

    it("completes checkin-target photo upload and merges into cafe gallery on real Postgres (#274)", async () => {
      // U2 has no check-in at CAFE_A (U1 owns the seed CHECKIN_A1), so the
      // DG64 revisit gate cannot fire — only the photo path is exercised.
      const photoId = randomUUID();
      await recordUploadIntent(U2, photoId);

      const created = await createCheckIn(
        U2,
        { cafe_id: CAFE_A, scores: { overall: 80 }, photo_ids: [photoId] },
        fakeProvisionPhotosDeps(),
      );
      expect(created.checkin_id).toBeDefined();

      // Verify photo is attached to checkin with source attribution
      const checkinRes = await dbClient.query("select photos from checkins where id = $1", [created.checkin_id]);
      const photos = checkinRes.rows[0].photos as Array<Record<string, unknown>>;
      expect(photos.some((p) => p.id === photoId)).toBe(true);
      expect(photos.find((p) => p.id === photoId)).toMatchObject({
        source: { type: "checkin", id: created.checkin_id },
      });

      // Verify photo is merged into cafe gallery
      const cafeRes = await dbClient.query("select gallery from cafes where id = $1", [CAFE_A]);
      const gallery = cafeRes.rows[0].gallery as Array<Record<string, unknown>>;
      expect(gallery.some((p) => p.id === photoId)).toBe(true);

      // Verify intent is consumed
      const intentRes = await dbClient.query(
        "select image_uuid from image_upload_intents where image_uuid = $1",
        [photoId],
      );
      expect(intentRes.rows).toHaveLength(0);
    });

    it("creation photo upload consumes the intent and mounts into gallery on real Postgres (#274)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: `Cover Photo Roasters ${randomUUID().slice(0, 8)}`,
          lat: 1.3005,
          lng: 103.832,
          city: "singapore",
          checkin: {
            scores: { overall: 80 },
            max_stay: "unlimited",
            note: "Photo attach verification",
            photo_ids: [photoId],
          },
        },
        fakeProvisionPhotosDeps(),
      );
      expect(created.cafe_id).toBeDefined();

      // Verify photo is in gallery
      const cafeRes = await dbClient.query("select gallery from cafes where id = $1", [created.cafe_id]);
      const gallery = cafeRes.rows[0].gallery as Array<Record<string, unknown>>;
      expect(gallery.some((p) => p.id === photoId)).toBe(true);

      // Verify intent is consumed
      const intentRes = await dbClient.query(
        "select image_uuid from image_upload_intents where image_uuid = $1",
        [photoId],
      );
      expect(intentRes.rows).toHaveLength(0);

      await dbClient.query("delete from checkins where cafe_id = $1", [created.cafe_id]);
      await dbClient.query("delete from cafes where id = $1", [created.cafe_id]);
    });

    it("creation photo upload with an unrecorded intent fails fast (single-use guarantee)", async () => {
      await expect(
        createCafeWithFirstCheckIn(
          U1,
          {
            name: `Unrecorded Photo Roasters ${randomUUID().slice(0, 8)}`,
            lat: 1.3005,
            lng: 103.832,
            city: "singapore",
            checkin: {
              scores: { overall: 80 },
              max_stay: "unlimited",
              note: "Unrecorded intent verification",
              photo_ids: [randomUUID()],
            },
          },
          fakeProvisionPhotosDeps(),
        ),
      ).rejects.toBeInstanceOf(PhotoIntentError);
    });
  });

  describeDb("cafe visibility reversible hide (DG147 / #229)", () => {
    it("hides private cafe from stranger (404 on getCafe and cafeExists) while owner sees it (200)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(U1, {
        name: "Secret Study Cafe",
        lat: 1.3005,
        lng: 103.856,
        city: "singapore",
        checkin: {
          scores: { overall: 85, wifi: 90 },
          max_stay: "unlimited",
          note: "Quiet and hidden gem",
          photo_ids: [photoId],
        },
      }, fakeProvisionPhotosDeps());

      // Initially public: stranger and anonymous can see it
      const publicCafeForStranger = await getCafe(created.cafe_id, U2);
      expect(publicCafeForStranger).not.toBeNull();
      expect(await cafeExists(created.cafe_id, U2)).toBe(true);
      expect(await cafeExists(created.cafe_id, null)).toBe(true);
      expect(await cafeExists(created.cafe_id, U1)).toBe(true);

      // Owner toggles to private
      const toggleRes = await setCafeVisibility(created.cafe_id, U1, "private");
      expect(toggleRes).toEqual({ ok: true, id: created.cafe_id, visibility: "private" });

      // Cafe remains live while private
      expect(await cafeExists(created.cafe_id, U1)).toBe(true);

      // Owner sees it (200 / truthy)
      const ownerCafe = await getCafe(created.cafe_id, U1);
      expect(ownerCafe).not.toBeNull();
      expect(ownerCafe?.name).toBe("Secret Study Cafe");
      expect(await cafeExists(created.cafe_id, U1)).toBe(true);

      // Stranger gets 404 (getCafe returns null, cafeExists returns false)
      const strangerCafe = await getCafe(created.cafe_id, U2);
      expect(strangerCafe).toBeNull();
      expect(await cafeExists(created.cafe_id, U2)).toBe(false);

      // Anonymous gets 404
      const anonCafe = await getCafe(created.cafe_id);
      expect(anonCafe).toBeNull();
      expect(await cafeExists(created.cafe_id)).toBe(false);
      expect(await cafeExists(created.cafe_id, null)).toBe(false);

      // getCafeLocation follows the same visibility rule (BRAWUKA-435): owner
      // gets coordinates, stranger and anonymous get null — no oracle.
      expect(await getCafeLocation(created.cafe_id, U1)).not.toBeNull();
      expect(await getCafeLocation(created.cafe_id, U2)).toBeNull();
      expect(await getCafeLocation(created.cafe_id)).toBeNull();

      // Owner can record navigation to own private cafe (P2); stranger gets CafeNotFoundError
      const nav = await recordNavigation(U1, created.cafe_id);
      expect(nav.id).toBeDefined();
      await expect(recordNavigation(U2, created.cafe_id)).rejects.toBeInstanceOf(CafeNotFoundError);

      // Non-owner (U2) cannot change visibility (403)
      await expect(setCafeVisibility(created.cafe_id, U2, "public")).rejects.toBeInstanceOf(CafeForbiddenError);
    });

    it("excludes private cafe from public list, search, nearby, and sitemap, but includes in owner views", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(U1, {
        name: "Exclusive Hideaway",
        lat: 1.301,
        lng: 103.857,
        city: "singapore",
        checkin: {
          scores: { overall: 90, wifi: 95 },
          max_stay: "unlimited",
          note: "Members only feel",
          photo_ids: [photoId],
        },
      }, fakeProvisionPhotosDeps());

      // Toggle to private
      await setCafeVisibility(created.cafe_id, U1, "private");

      // 1. listCafesNearby:
      // Anonymous / stranger: excluded
      const publicNearby = await listCafesNearby({
        lat: 1.301,
        lng: 103.857,
        radiusKm: 5,
        limit: 10,
      });
      expect(publicNearby.some((c) => c.id === created.cafe_id)).toBe(false);

      const strangerNearby = await listCafesNearby({
        lat: 1.301,
        lng: 103.857,
        radiusKm: 5,
        limit: 10,
        viewerId: U2,
      });
      expect(strangerNearby.some((c) => c.id === created.cafe_id)).toBe(false);

      // Owner: present
      const ownerNearby = await listCafesNearby({
        lat: 1.301,
        lng: 103.857,
        radiusKm: 5,
        limit: 10,
        viewerId: U1,
      });
      expect(ownerNearby.some((c) => c.id === created.cafe_id)).toBe(true);

      // 2. searchCafesInDb:
      // Stranger / anonymous: excluded
      const publicSearch = await searchCafesInDb({
        q: "Exclusive Hideaway",
        city: "singapore",
      });
      expect(publicSearch.some((c) => c.id === created.cafe_id)).toBe(false);

      const strangerSearch = await searchCafesInDb({
        q: "Exclusive Hideaway",
        city: "singapore",
        viewerId: U2,
      });
      expect(strangerSearch.some((c) => c.id === created.cafe_id)).toBe(false);

      // Owner: present
      const ownerSearch = await searchCafesInDb({
        q: "Exclusive Hideaway",
        city: "singapore",
        viewerId: U1,
      });
      expect(ownerSearch.some((c) => c.id === created.cafe_id)).toBe(true);

      // 3. listCafeSitemapEntries:
      // Excluded from sitemap
      const sitemap = await listCafeSitemapEntries();
      expect(sitemap.some((entry) => entry.id === created.cafe_id)).toBe(false);
    });

    it("round-trip public→private→public restores visibility", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(U1, {
        name: "Toggle Test Cafe",
        lat: 1.302,
        lng: 103.858,
        city: "singapore",
        checkin: {
          scores: { overall: 80 },
          max_stay: "unlimited",
          note: "Testing toggle reversibility",
          photo_ids: [photoId],
        },
      }, fakeProvisionPhotosDeps());

      // 1. Initial: public
      expect(await cafeExists(created.cafe_id, U2)).toBe(true);
      expect((await searchCafesInDb({ q: "Toggle Test Cafe", viewerId: U2 })).some((c) => c.id === created.cafe_id)).toBe(true);

      // 2. Toggle to private
      await setCafeVisibility(created.cafe_id, U1, "private");
      expect(await cafeExists(created.cafe_id, U2)).toBe(false);
      expect(await getCafe(created.cafe_id, U2)).toBeNull();
      expect((await searchCafesInDb({ q: "Toggle Test Cafe", viewerId: U2 })).some((c) => c.id === created.cafe_id)).toBe(false);

      // 3. Toggle back to public
      await setCafeVisibility(created.cafe_id, U1, "public");
      expect(await cafeExists(created.cafe_id, U2)).toBe(true);
      expect(await getCafe(created.cafe_id, U2)).not.toBeNull();
      expect((await searchCafesInDb({ q: "Toggle Test Cafe", viewerId: U2 })).some((c) => c.id === created.cafe_id)).toBe(true);
    });

    it("another user's profile map hides their private cafes while own profile is unaffected", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(U1, {
        name: "U1 Private Roast",
        lat: 1.303,
        lng: 103.859,
        city: "singapore",
        checkin: {
          scores: { overall: 88 },
          max_stay: "unlimited",
          note: "Private cafe visited by creator",
          photo_ids: [photoId],
        },
      }, fakeProvisionPhotosDeps());

      // Toggle to private
      await setCafeVisibility(created.cafe_id, U1, "private");

      // U1 views own profile: cafe is present and marked private (DG147 badge DTO)
      const ownProfileCafes = await getUserCafes(U1, { viewerId: U1 });
      const ownItem = ownProfileCafes.items.find((c) => c.id === created.cafe_id);
      expect(ownItem?.visibility).toBe("private");

      // U2 views U1's profile: private cafe is hidden
      const strangerViewingU1 = await getUserCafes(U1, { viewerId: U2 });
      expect(strangerViewingU1.items.some((c) => c.id === created.cafe_id)).toBe(false);

      // Anonymous viewing U1's profile: private cafe is hidden
      const anonViewingU1 = await getUserCafes(U1, { viewerId: null });
      expect(anonViewingU1.items.some((c) => c.id === created.cafe_id)).toBe(false);
    });

    it("work_stats continue computing without freezing or invalidation while private", async () => {
      const photoId1 = randomUUID();
      await recordUploadIntent(U1, photoId1);

      const created = await createCafeWithFirstCheckIn(U1, {
        name: "Stats In Private Cafe",
        lat: 1.304,
        lng: 103.860,
        city: "singapore",
        checkin: {
          scores: { overall: 70, wifi: 60 },
          max_stay: "unlimited",
          note: "Initial checkin",
          photo_ids: [photoId1],
        },
      }, fakeProvisionPhotosDeps());
      // Toggle to private
      await setCafeVisibility(created.cafe_id, U1, "private");

      // DG64: the fused creation check-in is still live, so age it past the
      // revisit window — this test covers visibility, not the window.
      await dbClient.query("update checkins set visited_at = now() - interval '25 hours' where id = $1", [
        created.checkin_id,
      ]);

      // Add another check-in while private
      const photoId2 = randomUUID();
      await recordUploadIntent(U1, photoId2);
      await createCheckIn(U1, {
        cafe_id: created.cafe_id,
        scores: { overall: 90, wifi: 80 },
        max_stay: "unlimited",
        note: "Second checkin while private",
        photo_ids: [photoId2],
      }, fakeProvisionPhotosDeps());
      // Verify work_stats updated
      const cafe = await getCafe(created.cafe_id, U1);
      expect(cafe?.work_stats.n_checkins).toBe(2);
    });

    it("blocks non-owner check-in writes on a private cafe while the owner still writes (BRAWUKA-392)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(U1, {
        name: "Private Write Gate Cafe",
        lat: 1.305,
        lng: 103.861,
        city: "singapore",
        checkin: {
          scores: { overall: 75, wifi: 70 },
          max_stay: "unlimited",
          note: "Owner creation visit",
          photo_ids: [photoId],
        },
      }, fakeProvisionPhotosDeps());
      await setCafeVisibility(created.cafe_id, U1, "private");

      // Stranger write → CafeNotFoundError (the route maps it to 404), same as the read path.
      const err = await createCheckIn(U2, {
        cafe_id: created.cafe_id,
        scores: { overall: 60 },
      }).catch((e) => e);
      expect(err).toBeInstanceOf(CafeNotFoundError);

      // The rejected write leaves no row behind — the owner never sees "other check-ins".
      const leaked = await dbClient.query(
        "select count(*)::int as n from checkins where cafe_id = $1 and user_id = $2 and deleted_at is null",
        [created.cafe_id, U2],
      );
      expect(leaked.rows[0].n).toBe(0);

      // Owner write still works (age the creation check-in past the DG64 window first).
      await dbClient.query("update checkins set visited_at = now() - interval '25 hours' where id = $1", [
        created.checkin_id,
      ]);
      const own = await createCheckIn(U1, {
        cafe_id: created.cafe_id,
        scores: { overall: 85 },
      });
      expect(own.checkin_id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describeDb("opt-in public author identity consent lifecycle (DG139 / #139 Stage 1)", () => {
    it("manages the complete opt-in, handle generation, handle edit, cooldown, and opt-out lifecycle", async () => {
      const userA = randomUUID();
      const userB = randomUUID();

      // Seed profiles
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad'), ($2, 'Bob Nomad')",
        [userA, userB],
      );

      // 1. Default state: show_public_identity = false, public_handle = null, identity_consented_at = null
      const initial = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at, public_handle_changed_at from profiles where id = $1",
        [userA],
      );
      expect(initial.rows[0].show_public_identity).toBe(false);
      expect(initial.rows[0].public_handle).toBeNull();
      expect(initial.rows[0].identity_consented_at).toBeNull();
      expect(initial.rows[0].public_handle_changed_at).toBeNull();

      // 2. Opt-in generates collision-safe handle slug(display_name)-xxxx and stamps identity_consented_at
      const optedIn = await updateProfileIdentity(userA, { showPublicIdentity: true });
      expect(optedIn.showPublicIdentity).toBe(true);
      expect(optedIn.publicHandle).toMatch(/^alex-nomad-[0-9a-f]{4}$/);
      expect(optedIn.identityConsentedAt).not.toBeNull();
      expect(optedIn.publicHandleChangedAt).toBeNull(); // Allows immediate customization!

      // 3. First user customization of server-generated handle is allowed immediately
      const customized = await updateProfileIdentity(userA, {
        showPublicIdentity: true,
        publicHandle: "alex-custom",
      });
      expect(customized.showPublicIdentity).toBe(true);
      expect(customized.publicHandle).toBe("alex-custom");
      expect(customized.publicHandleChangedAt).not.toBeNull();

      // 4. Changing handle again within 7 days is rejected with HandleChangeTooSoonError
      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: true,
          publicHandle: "alex-again",
        }),
      ).rejects.toThrow(HandleChangeTooSoonError);

      // 5. Invalid handle format is rejected
      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: true,
          publicHandle: "Invalid-Format!",
        }),
      ).rejects.toThrow(InvalidHandleError);

      // 6. Opt-out clears identity_consented_at, sets show_public_identity = false, and retains reserved handle
      const optedOut = await updateProfileIdentity(userA, { showPublicIdentity: false });
      expect(optedOut.showPublicIdentity).toBe(false);
      expect(optedOut.publicHandle).toBe("alex-custom");
      expect(optedOut.identityConsentedAt).toBeNull();

      // Direct DB assertion to verify SQL state
      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(false);
      expect(dbRow.rows[0].public_handle).toBe("alex-custom");
      expect(dbRow.rows[0].identity_consented_at).toBeNull();

      // 7. Anti-squatting: another user cannot claim the reserved handle even while User A is opted out
      await expect(
        updateProfileIdentity(userB, {
          showPublicIdentity: true,
          publicHandle: "alex-custom",
        }),
      ).rejects.toThrow(HandleTakenError);

      // 8. Re-opt-in reuses the reserved handle without generating a new one
      const reOptedIn = await updateProfileIdentity(userA, { showPublicIdentity: true });
      expect(reOptedIn.showPublicIdentity).toBe(true);
      expect(reOptedIn.publicHandle).toBe("alex-custom");
      expect(reOptedIn.identityConsentedAt).not.toBeNull();
    });
    it("applies a publicHandle sent in the same request as opt-out (spec 0006)", async () => {
      const userA = randomUUID();
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad')",
        [userA],
      );
      // Opt-in with an auto-generated handle: public_handle_changed_at stays
      // null, so the first user-chosen edit is permitted immediately.
      const optedIn = await updateProfileIdentity(userA, {
        showPublicIdentity: true,
      });
      expect(optedIn.identityConsentedAt).not.toBeNull();
      expect(optedIn.publicHandleChangedAt).toBeNull();

      // Opt-out carrying a new handle: handle is still validated and applied —
      // handle management is independent of the consent flag.
      const optedOut = await updateProfileIdentity(userA, {
        showPublicIdentity: false,
        publicHandle: "alex-offline",
      });
      expect(optedOut.showPublicIdentity).toBe(false);
      expect(optedOut.publicHandle).toBe("alex-offline");
      expect(optedOut.identityConsentedAt).toBeNull();
      expect(optedOut.publicHandleChangedAt).not.toBeNull();

      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at, public_handle_changed_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(false);
      expect(dbRow.rows[0].public_handle).toBe("alex-offline");
      expect(dbRow.rows[0].identity_consented_at).toBeNull();
      expect(dbRow.rows[0].public_handle_changed_at).not.toBeNull();
    });

    it("rejects an invalid publicHandle sent with opt-out and leaves consent untouched", async () => {
      const userA = randomUUID();
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad')",
        [userA],
      );
      await updateProfileIdentity(userA, {
        showPublicIdentity: true,
        publicHandle: "alex-custom",
      });

      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: false,
          publicHandle: "Invalid-Format!",
        }),
      ).rejects.toThrow(InvalidHandleError);

      // Validation throws before the write: the opt-out is not applied either.
      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(true);
      expect(dbRow.rows[0].public_handle).toBe("alex-custom");
      expect(dbRow.rows[0].identity_consented_at).not.toBeNull();
    });

    it("enforces the 7-day cooldown on a publicHandle sent with opt-out", async () => {
      const userA = randomUUID();
      await dbClient.query(
        "insert into profiles (id, display_name) values ($1, 'Alex Nomad')",
        [userA],
      );
      // User-chosen handle stamps public_handle_changed_at; a second change
      // inside 7 days is rejected even when the request also opts out.
      await updateProfileIdentity(userA, {
        showPublicIdentity: true,
        publicHandle: "alex-custom",
      });

      await expect(
        updateProfileIdentity(userA, {
          showPublicIdentity: false,
          publicHandle: "alex-offline",
        }),
      ).rejects.toThrow(HandleChangeTooSoonError);

      const dbRow = await dbClient.query(
        "select show_public_identity, public_handle, identity_consented_at from profiles where id = $1",
        [userA],
      );
      expect(dbRow.rows[0].show_public_identity).toBe(true);
      expect(dbRow.rows[0].public_handle).toBe("alex-custom");
      expect(dbRow.rows[0].identity_consented_at).not.toBeNull();
    });
  });
  describeDb("BRAWUKA-180 split-module backfill on real SQL", () => {
    // Deterministic synchronization: poll pg_locks for the ungranted transactionid
    // lock where the concurrent victim blocks on the unique index. This eliminates
    // arbitrary sleep timeouts that fail over high-latency or tunneled connections.
    async function waitForBlockedVictim(holder: pg.Client, timeoutMs = 15_000): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const res = await holder.query<{ count: string }>(
          "select count(*) from pg_locks where not granted and locktype = 'transactionid'",
        );
        if (parseInt(res.rows[0]?.count ?? "0", 10) > 0) {
          return;
        }
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 50);
        await promise;
      }
      throw new Error(`waitForBlockedVictim timed out after ${timeoutMs}ms waiting for victim to block`);
    }

    it("parseNavigationBody validates bodies; recordNavigation writes and 404s", async () => {
      expect(parseNavigationBody(null)).toEqual({ ok: false, message: "object body required" });
      expect(parseNavigationBody([])).toEqual({ ok: false, message: "object body required" });
      expect(parseNavigationBody({})).toEqual({ ok: false, message: "cafe_id (UUID string) required" });
      expect(parseNavigationBody({ cafe_id: "not-a-uuid" })).toEqual({
        ok: false,
        message: "cafe_id (UUID string) required",
      });
      expect(parseNavigationBody({ cafe_id: CAFE_A })).toEqual({ ok: true, value: { cafe_id: CAFE_A } });

      const recorded = await recordNavigation(U1, CAFE_A);
      expect(recorded.id).toMatch(/^[0-9a-f-]{36}$/);
      const stored = await dbClient.query("select cafe_id, user_id from navigations where id = $1", [
        recorded.id,
      ]);
      expect(stored.rows[0]).toMatchObject({ cafe_id: CAFE_A, user_id: U1 });

      await expect(recordNavigation(U1, randomUUID())).rejects.toBeInstanceOf(CafeNotFoundError);
      await expect(recordNavigation("bad-id", CAFE_A)).rejects.toThrow("Invalid user ID");
      await expect(recordNavigation(U1, "bad-id")).rejects.toThrow("Invalid cafe ID");
    });

    it("service-account marker + timezone fallback (cafes/meta)", async () => {
      expect(isServiceMaintained(null)).toBe(true);
      expect(isServiceMaintained(undefined)).toBe(true);
      expect(isServiceMaintained(SERVICE_ACCOUNT_ID)).toBe(true);
      expect(isServiceMaintained(U1)).toBe(false);
      expect(resolveCafeTimezone(999, 999)).toBe("UTC");
      expect(resolveCafeTimezone(999, 999, "singapore")).toBe("Asia/Singapore");

      // A null created_by is marked service-maintained in list + detail projections.
      const nullOwnerId = randomUUID();
      await dbClient.query(
        `insert into cafes (id, name, location, created_by, tz)
         values ($1, 'Null Owner', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, null, 'Asia/Singapore')`,
        [nullOwnerId],
      );
      const nearby = await listCafesNearby({ lat: 1.35, lng: 103.8, radiusKm: 5, limit: 10 });
      expect(nearby.find((c) => c.id === nullOwnerId)?.maintained_by_service).toBe(true);
      const detail = await getCafe(nullOwnerId);
      expect(detail && toPublicCafeDetail(detail).maintained_by_service).toBe(true);
    });

    it("setCafeVisibility guards + idempotent toggle persist to the row", async () => {
      await expect(setCafeVisibility("bad-id", U1, "public")).rejects.toBeInstanceOf(CafeNotFoundError);
      await expect(setCafeVisibility(randomUUID(), U1, "public")).rejects.toBeInstanceOf(CafeNotFoundError);
      await expect(setCafeVisibility(CAFE_A, U1, "hidden" as "public")).rejects.toThrow("visibility must be");
      await expect(setCafeVisibility(CAFE_A, U2, "private")).rejects.toBeInstanceOf(CafeForbiddenError);

      expect(await setCafeVisibility(CAFE_A, U1, "private")).toEqual({
        ok: true,
        id: CAFE_A,
        visibility: "private",
      });
      expect(await setCafeVisibility(CAFE_A, U1, "private")).toEqual({
        ok: true,
        id: CAFE_A,
        visibility: "private",
      });
      expect(await setCafeVisibility(CAFE_A, U1, "public")).toEqual({
        ok: true,
        id: CAFE_A,
        visibility: "public",
      });
      const stored = await dbClient.query("select visibility from cafes where id = $1", [CAFE_A]);
      expect(stored.rows[0].visibility).toBe("public");
    });

    it("a lost external-id race collapses to the winner via the 23505 gate", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);
      const holder = new pg.Client(getPoolConfig(testDbUrl));
      await holder.connect();
      const holderCafe = randomUUID();
      try {
        // Uncommitted winner: the victim's fast-path + in-tx pre-check both miss,
        // so its insert blocks on the unique index and hits the 23505 catch.
        await holder.query("begin");
        await holder.query(
          `insert into cafes (id, name, location, google_place_id, created_by, tz)
           values ($1, 'Race Holder', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography,
                   'ChIJ-race-1', $2, 'Asia/Singapore')`,
          [holderCafe, U1],
        );
        const pending = createCafeWithFirstCheckIn(
          U1,
          {
            name: "Race Loser",
            lat: 1.35,
            lng: 103.8,
            google_place_id: "ChIJ-race-1",
            checkin: { scores: { overall: 70 }, max_stay: "unlimited", note: "race", photo_ids: [photoId] },
          },
          fakeProvisionPhotosDeps(),
        );
        await waitForBlockedVictim(holder);
        await holder.query("commit");
        const err = await pending.then(
          () => null,
          (e) => e,
        );
        expect(err).toBeInstanceOf(CafeExistsError);
        expect((err as CafeExistsError).existingCafeId).toBe(holderCafe);
      } finally {
        await holder.end();
      }
    });

    it("createCheckIn validates the key and wins the insert race via ON CONFLICT", async () => {
      await expect(
        createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 60 }, idempotency_key: "bad" }),
      ).rejects.toThrow("Invalid idempotency key");

      const key = randomUUID();
      const holder = new pg.Client(getPoolConfig(testDbUrl));
      await holder.connect();
      try {
        await holder.query("begin");
        await holder.query(
          `insert into checkins (cafe_id, user_id, is_creation, scores, idempotency_key)
           values ($1, $2, false, '{}', $3)`,
          [CAFE_A, U2, key],
        );
        const pending = createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 60 }, idempotency_key: key });
        await waitForBlockedVictim(holder);
        await holder.query("commit");
        const result = await pending;
        expect(result.deduped).toBe(true);
        const stored = await dbClient.query(
          "select id from checkins where user_id = $1 and idempotency_key = $2",
          [U2, key],
        );
        expect(stored.rows).toHaveLength(1);
        expect(result.checkin_id).toBe(stored.rows[0].id);
      } finally {
        await holder.end();
      }
    });

    it("updateCheckIn applies visited_at; toggleCheckInLike validates ids", async () => {
      const stamped = new Date("2024-05-01T08:00:00.000Z");
      const { cafe_id } = await updateCheckIn(U1, CHECKIN_A1, { visited_at: stamped });
      expect(cafe_id).toBe(CAFE_A);
      const stored = await dbClient.query("select visited_at from checkins where id = $1", [CHECKIN_A1]);
      expect(new Date(stored.rows[0].visited_at).toISOString()).toBe(stamped.toISOString());
      await expect(toggleCheckInLike("bad", CHECKIN_A1)).rejects.toThrow("Invalid user or check-in ID");
    });

    it("last-checkin lookup returns the newest row for the viewer", async () => {
      expect(await getLastCheckinForCafe("bad-id", CAFE_A)).toBeNull();
      expect(await getLastCheckinForCafe(U2, CAFE_A)).toBeNull();
      const created = await createCheckIn(U2, { cafe_id: CAFE_A, scores: { overall: 77 }, note: "last one" });
      const last = await getLastCheckinForCafe(U2, CAFE_A);
      expect(last?.id).toBe(created.checkin_id);
      expect(last?.scores).toEqual({ overall: 77 });
    });

    it("creation photo attach mounts into gallery on real Postgres", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U1, photoId);

      const created = await createCafeWithFirstCheckIn(
        U1,
        {
          name: `Gallery Cover Roasters ${randomUUID().slice(0, 8)}`,
          lat: 1.3005,
          lng: 103.832,
          city: "singapore",
          checkin: {
            scores: { overall: 80 },
            max_stay: "unlimited",
            note: "Gallery attach verification",
            photo_ids: [photoId],
          },
        },
        fakeProvisionPhotosDeps(),
      );

      const stored = await dbClient.query("select gallery from cafes where id = $1", [created.cafe_id]);
      const gallery = stored.rows[0].gallery as Array<Record<string, unknown>>;
      expect(gallery.some((p) => p.id === photoId)).toBe(true);

      await dbClient.query("delete from checkins where cafe_id = $1", [created.cafe_id]);
      await dbClient.query("delete from cafes where id = $1", [created.cafe_id]);
    });
    it("cafe reads: invalid id, missing row, existence probes", async () => {
      await expect(getCafe("bad-id")).rejects.toThrow("Invalid cafe ID");
      expect(await getCafe(randomUUID())).toBeNull();
      expect(await cafeExists("bad-id")).toBe(false);
      expect(await cafeExists(randomUUID())).toBe(false);
      expect(await cafeExists(CAFE_A)).toBe(true);
      expect(await cafeExists(CAFE_A, U1)).toBe(true);
      expect(await cafeExists(CAFE_A, U2)).toBe(true);
    });
  });

  describeDb("account lifecycle (BRAWUKA-504, DG149)", () => {
    it("deleteAccount removes a user who has check-ins — FK detach keeps tombstones", async () => {
      // U1 owns CAFE_A + CHECKIN_A1 (the creation check-in). The FK that
      // blocked the original implementation is checkins.user_id → profiles.
      const result = await deleteAccount(U1);
      expect(result.ok).toBe(true);
      expect(result.checkins_removed).toBe(1);
      expect(result.cafes_transferred).toBe(1);

      const profile = await dbClient.query("select id from profiles where id = $1", [U1]);
      expect(profile.rows).toHaveLength(0);

      // Tombstone preserved, author detached.
      const checkin = await dbClient.query(
        "select user_id, deleted_at from checkins where id = $1",
        [CHECKIN_A1],
      );
      expect(checkin.rows[0].user_id).toBeNull();
      expect(checkin.rows[0].deleted_at).not.toBeNull();

      // Created cafe survives as a service-account orphan shell.
      const cafe = await dbClient.query("select created_by from cafes where id = $1", [CAFE_A]);
      expect(cafe.rows[0].created_by).toBe(SERVICE_ACCOUNT_ID);
    });

    it("deleteAccount releases R2 variants for the user's check-in photos (BRAWUKA-433)", async () => {
      const photoId = randomUUID();
      await recordUploadIntent(U2, photoId);
      const deps = fakeProvisionPhotosDeps();
      await createCheckIn(
        U2,
        { cafe_id: CAFE_A, scores: { overall: 70 }, photo_ids: [photoId] },
        deps,
      );

      const deleted: string[] = [];
      const realDelete = deps.deleteProvisionedVariants;
      if (!realDelete) throw new Error("expected a delete dep in the fixture");
      deps.deleteProvisionedVariants = async (id) => {
        deleted.push(id);
        await realDelete(id);
      };

      const result = await deleteAccount(U2, deps);
      expect(result.checkins_removed).toBe(1);
      expect(deleted).toEqual([photoId]);
    });


    it("concurrent deleteAccount + deleteCafe on the same cafe never deadlocks (BRAWUKA-574)", async () => {
      // Regression: deleteAccount locked check-ins first while deleteCafe
      // locked cafe first — overlapping the two hit 40P01 on round 0.
      // Both now take cafe → checkin order, so the loser waits instead of
      // cycling. Every round reseeds (one side always wins and deletes the
      // cafe's rows), then asserts neither side saw deadlock_detected.
      for (let round = 0; round < 5; round++) {
        await dbClient.query("alter table checkin_likes enable trigger all");
        await dbClient.query(
          "truncate table profiles, cafes, image_upload_intents, navigations restart identity cascade",
        );
        await seedBaseData(dbClient);
        const results = await Promise.allSettled([
          deleteAccount(U1),
          deleteCafe(CAFE_A, U1, { confirm: true }),
        ]);
        for (const result of results) {
          if (result.status === "rejected") {
            const code = (result.reason as { code?: string } | null)?.code;
            expect(code, `round ${round}: deadlock: ${String(result.reason)}`).not.toBe("40P01");
          }
        }
      }
    });

    it("check-in committed inside the lock window cannot invert lock order (BRAWUKA-601)", async () => {
      // Regression: the two locking SELECTs took separate snapshots. A
      // check-in committed between them was locked while its cafe was not;
      // the gallery purge then took the cafe lock after the check-in lock —
      // checkin → cafe, deadlocking against a concurrent cafe → checkin
      // writer (40P01). The single-statement lock reads both sets under one
      // snapshot, so the new check-in's cafe is simply outside the lock set.
      //
      // Deterministic interleave: a barrier tx holds CAFE_A so the lock
      // statement blocks mid-scan with its snapshot already taken; the new
      // check-in commits inside that window. A contender then takes
      // CAFE_B → NEW_CI (softDeleteCheckIn's order) and waits for the
      // check-in lock — on the old code that request completes the cycle
      // with the purge's blocked `update cafes` on CAFE_B.
      const CAFE_B = randomUUID();
      const NEW_CI = randomUUID();
      await dbClient.query(
        `insert into cafes (id, name, location, city, created_by, tz)
         values ($1, 'Gap Cafe', ST_SetSRID(ST_MakePoint(103.9, 1.36), 4326)::geography,
                 'singapore', $2, 'Asia/Singapore')`,
        [CAFE_B, U2],
      );

      const barrier = new pg.Client(getPoolConfig(testDbUrl));
      const contender = new pg.Client(getPoolConfig(testDbUrl));
      await Promise.all([barrier.connect(), contender.connect()]);
      try {
        await barrier.query("begin");
        await barrier.query("select 1 from cafes where id = $1 for update", [CAFE_A]);

        const deletePromise = deleteAccount(U1);
        let deleteSettled = false;
        void deletePromise.then(
          () => { deleteSettled = true; },
          () => { deleteSettled = true; },
        );

        // Poll pg_stat_activity until the lock statement is blocked on
        // CAFE_A — its snapshot is already taken, so the insert below
        // commits inside the window. Real polling is required: the awaited
        // condition is lock state in a live Postgres backend, not a timer
        // under test (same pattern as waitForBlockedVictim above).
        const lockDeadline = Date.now() + 10_000;
        for (;;) {
          const { rows } = await dbClient.query(
            `select 1 from pg_stat_activity
             where datname = current_database()
               and wait_event_type = 'Lock'
               and query like '%for update%'`,
          );
          if (rows.length > 0) break;
          if (Date.now() > lockDeadline) {
            throw new Error("deleteAccount lock statement never blocked on CAFE_A");
          }
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, 25);
          await promise;
        }

        await dbClient.query(
          `insert into checkins (id, cafe_id, user_id, scores)
           values ($1, $2, $3, '{"wifi": 70}'::jsonb)`,
          [NEW_CI, CAFE_B, U1],
        );

        // softDeleteCheckIn's order on the new pair: cafe first, then the
        // check-in. Taken before the barrier releases so the purge can
        // never reach CAFE_B first on the old code.
        await contender.query("begin");
        await contender.query("select 1 from cafes where id = $1 for update", [CAFE_B]);

        await barrier.query("commit");

        // Old code only: wait for the purge to block on CAFE_B (proof that
        // deleteAccount holds NEW_CI), then the contender's check-in lock
        // request completes the cycle. New code never reaches that state —
        // deleteAccount settles, the poll exits, and the contender's lock
        // request is uncontended.
        const purgeDeadline = Date.now() + 10_000;
        while (!deleteSettled && Date.now() < purgeDeadline) {
          const { rows } = await dbClient.query(
            `select 1 from pg_stat_activity
             where datname = current_database()
               and wait_event_type = 'Lock'
               and query like '%set gallery%'`,
          );
          if (rows.length > 0) break;
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, 25);
          await promise;
        }

        const [deleteResult, contenderResult] = await Promise.allSettled([
          deletePromise,
          contender.query("select 1 from checkins where id = $1 for update", [NEW_CI]),
        ]);
        for (const [label, result] of [
          ["deleteAccount", deleteResult],
          ["contender", contenderResult],
        ] as const) {
          if (result.status === "rejected") {
            const code = (result.reason as { code?: string } | null)?.code;
            expect(code, `${label}: ${String(result.reason)}`).not.toBe("40P01");
          }
        }
        await contender.query("commit");

        const result = await deletePromise;
        // NEW_CI committed after the lock snapshot: not counted, but still
        // tombstoned + detached by the blanket UPDATE — no live orphan.
        expect(result.checkins_removed).toBe(1);
        const checkin = await dbClient.query(
          "select user_id, deleted_at from checkins where id = $1",
          [NEW_CI],
        );
        expect(checkin.rows[0].deleted_at).not.toBeNull();
        expect(checkin.rows[0].user_id).toBeNull();

        const live = await dbClient.query(
          "select id from checkins where user_id = $1 and deleted_at is null",
          [U1],
        );
        expect(live.rows).toHaveLength(0);
        const profile = await dbClient.query("select id from profiles where id = $1", [U1]);
        expect(profile.rows).toHaveLength(0);
      } finally {
        await Promise.allSettled([barrier.end(), contender.end()]);
      }
    });

    it("getProfileExport returns the full bundle against the real schema", async () => {
      const bundle = await getProfileExport(U1);
      expect(bundle.profile?.id).toBe(U1);
      expect(bundle.checkins).toHaveLength(1);
      expect(bundle.checkins[0]).toMatchObject({ id: CHECKIN_A1, cafe_id: CAFE_A });
      expect(bundle.cafes_created).toHaveLength(1);
      const exportedCafe = bundle.cafes_created[0] as { id: string; name: string; lat: number; lng: number };
      expect(exportedCafe).toMatchObject({ id: CAFE_A, name: "Seed Cafe" });
      // geography → lat/lng projection actually resolves (was a 500 on
      // non-existent cafes.lat/lng columns).
      expect(exportedCafe.lat).toBeCloseTo(1.35, 3);
      expect(exportedCafe.lng).toBeCloseTo(103.8, 3);
      expect(bundle.navigations).toEqual([]);
      // BRAWUKA-583: every table deleteAccount touches is exported —
      // pending upload intents included.
      await dbClient.query(
        "insert into image_upload_intents (image_uuid, user_id) values (gen_random_uuid(), $1)",
        [U1],
      );
      const withIntent = await getProfileExport(U1);
      expect(withIntent.image_upload_intents).toHaveLength(1);
    });
  });

  describeDb("0031 profile city backfill audit predicates (BRAWUKA-695)", () => {
    it("backfills corrupted launch city rows >50km from center, leaves <=50km and null location rows untouched", async () => {
      await dbClient.query("delete from profile_city_backfill_audit");

      const testUrumqi = "00000000-0000-4000-b000-000000000001";
      const testShanghaiNear = "00000000-0000-4000-b000-000000000002";
      const testNoLoc = "00000000-0000-4000-b000-000000000003";
      const testHongKongFar = "00000000-0000-4000-b000-000000000004";
      const testOtherCity = "00000000-0000-4000-b000-000000000005";

      await dbClient.query(
        `insert into profiles (id, display_name, current_city, last_location)
         values ($1, 'Urumqi User', 'shanghai', ST_SetSRID(ST_MakePoint(87.6168, 43.8256), 4326)::geography)
         on conflict (id) do update set current_city = 'shanghai', last_location = ST_SetSRID(ST_MakePoint(87.6168, 43.8256), 4326)::geography`,
        [testUrumqi],
      );
      await dbClient.query(
        `insert into profiles (id, display_name, current_city, last_location)
         values ($1, 'Shanghai User', 'shanghai', ST_SetSRID(ST_MakePoint(121.4737, 31.2304), 4326)::geography)
         on conflict (id) do update set current_city = 'shanghai', last_location = ST_SetSRID(ST_MakePoint(121.4737, 31.2304), 4326)::geography`,
        [testShanghaiNear],
      );
      await dbClient.query(
        `insert into profiles (id, display_name, current_city, last_location)
         values ($1, 'No Loc User', 'shanghai', null)
         on conflict (id) do update set current_city = 'shanghai', last_location = null`,
        [testNoLoc],
      );
      await dbClient.query(
        `insert into profiles (id, display_name, current_city, last_location)
         values ($1, 'Hong Kong Far', 'hong-kong', ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326)::geography)
         on conflict (id) do update set current_city = 'hong-kong', last_location = ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326)::geography`,
        [testHongKongFar],
      );
      await dbClient.query(
        `insert into profiles (id, display_name, current_city, last_location)
         values ($1, 'Other City User', 'rt-america-sao_paulo', ST_SetSRID(ST_MakePoint(-46.6333, -23.5505), 4326)::geography)
         on conflict (id) do update set current_city = 'rt-america-sao_paulo', last_location = ST_SetSRID(ST_MakePoint(-46.6333, -23.5505), 4326)::geography`,
        [testOtherCity],
      );

      await dbClient.query(`
        with launch_targets(city_id, center_point, new_city) as (
          values
            ('singapore', ST_SetSRID(ST_MakePoint(103.8198, 1.3521), 4326)::geography, 'rt-asia-singapore'),
            ('tokyo', ST_SetSRID(ST_MakePoint(139.6503, 35.6762), 4326)::geography, 'rt-asia-tokyo'),
            ('seoul', ST_SetSRID(ST_MakePoint(126.978, 37.5665), 4326)::geography, 'rt-asia-seoul'),
            ('taipei', ST_SetSRID(ST_MakePoint(121.5654, 25.033), 4326)::geography, 'rt-asia-taipei'),
            ('shanghai', ST_SetSRID(ST_MakePoint(121.4737, 31.2304), 4326)::geography, 'rt-asia-shanghai'),
            ('bangkok', ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography, 'rt-asia-bangkok'),
            ('hongkong', ST_SetSRID(ST_MakePoint(114.1694, 22.3193), 4326)::geography, 'rt-asia-hong_kong'),
            ('hong-kong', ST_SetSRID(ST_MakePoint(114.1694, 22.3193), 4326)::geography, 'rt-asia-hong_kong'),
            ('melbourne', ST_SetSRID(ST_MakePoint(144.9631, -37.8136), 4326)::geography, 'rt-australia-melbourne'),
            ('berlin', ST_SetSRID(ST_MakePoint(13.405, 52.52), 4326)::geography, 'rt-europe-berlin'),
            ('london', ST_SetSRID(ST_MakePoint(-0.1278, 51.5074), 4326)::geography, 'rt-europe-london')
        ),
        candidates as (
          select p.id as user_id, p.current_city as old_city, t.new_city
          from profiles p
          join launch_targets t on p.current_city = t.city_id
          where p.last_location is not null
            and ST_Distance(p.last_location, t.center_point) > 50000
        )
        insert into profile_city_backfill_audit (user_id, old_city, new_city, migrated_at)
        select user_id, old_city, new_city, now()
        from candidates
        on conflict (user_id) do nothing;

        update profiles p
        set current_city = a.new_city
        from profile_city_backfill_audit a
        where p.id = a.user_id;
      `);

      const auditRows = await dbClient.query(
        "select user_id, old_city, new_city from profile_city_backfill_audit order by user_id",
      );
      expect(auditRows.rows).toEqual([
        { user_id: testUrumqi, old_city: "shanghai", new_city: "rt-asia-shanghai" },
        { user_id: testHongKongFar, old_city: "hong-kong", new_city: "rt-asia-hong_kong" },
      ]);

      const p1 = await dbClient.query("select current_city from profiles where id = $1", [testUrumqi]);
      expect(p1.rows[0].current_city).toBe("rt-asia-shanghai");

      const p2 = await dbClient.query("select current_city from profiles where id = $1", [testShanghaiNear]);
      expect(p2.rows[0].current_city).toBe("shanghai");

      const p3 = await dbClient.query("select current_city from profiles where id = $1", [testNoLoc]);
      expect(p3.rows[0].current_city).toBe("shanghai");

      const p4 = await dbClient.query("select current_city from profiles where id = $1", [testHongKongFar]);
      expect(p4.rows[0].current_city).toBe("rt-asia-hong_kong");

      const p5 = await dbClient.query("select current_city from profiles where id = $1", [testOtherCity]);
      expect(p5.rows[0].current_city).toBe("rt-america-sao_paulo");

      await dbClient.query("delete from profiles where id in ($1, $2, $3, $4, $5)", [
        testUrumqi,
        testShanghaiNear,
        testNoLoc,
        testHongKongFar,
        testOtherCity,
      ]);
      await dbClient.query("delete from profile_city_backfill_audit");
    });
  });
});
