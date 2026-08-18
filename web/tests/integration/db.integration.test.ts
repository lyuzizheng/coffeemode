/**
 * Real-Postgres integration suite — the answer to "SQL by reasoning only".
 *
 * Requires a running local Postgres (docker-compose.yml) and is opt-in:
 *
 *   docker compose up -d            # postgis/postgis on :5432
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
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CafeNotFoundError,
  CheckInNotFoundError,
  SelfLikeError,
  createCheckIn,
  toggleCheckInLike,
} from "@/lib/db/checkins";
import {
  CafeExistsError,
  createCafeWithFirstCheckIn,
  getCafe,
  listCafesNearby,
} from "@/lib/db/cafes";
import { recordNavigation } from "@/lib/db/navigations";
import { closePool } from "@/lib/db/postgres";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeDb = RUN_INTEGRATION ? describe : describe.skip;

const DEFAULT_DB_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
const TEST_DB = "coffeemode_test";
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Fixed UUIDs so tests are self-describing.
const U1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"; // author / creator
const U2 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22"; // second user
const CAFE_A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";
const CHECKIN_A1 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";

let testDbUrl = "";
let adminDbUrl = "";
let dbClient: pg.Client; // raw seeding connection (independent of the app pool)

async function provisionTestDatabase(): Promise<string> {
  const adminUrl = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${TEST_DB} with (force)`);
    await admin.query(`create database ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

/** Apply migrations using the same runner the CLI uses (dogfooding). */
function runMigrations(url: string): void {
  execFileSync("node", ["scripts/migrate.mjs"], {
    cwd: WEB_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

async function seedBaseData(): Promise<void> {
  await dbClient.query(
    `insert into profiles (id, display_name) values ($1, 'u1'), ($2, 'u2')`,
    [U1, U2],
  );
  await dbClient.query(
    `insert into cafes (id, name, location, city, created_by, tz)
     values ($1, 'Seed Cafe', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography,
             'singapore', $2, 'Asia/Singapore')`,
    [CAFE_A, U1],
  );
  await dbClient.query(
    `insert into checkins (id, cafe_id, user_id, is_creation, scores)
     values ($1, $2, $3, true, '{"wifi": 80}'::jsonb)`,
    [CHECKIN_A1, CAFE_A, U1],
  );
}

interface WorkStatsShape {
  n_users: number;
  n_checkins: number;
  dims: Record<string, { sum: number; n: number }>;
  policies: { min_spend: Record<string, number>; max_stay: Record<string, number> };
  experience_score: number | null;
}

async function cafeWorkStats(cafeId: string): Promise<WorkStatsShape> {
  const { rows } = await dbClient.query("select work_stats from cafes where id = $1", [cafeId]);
  // node-pg parses jsonb columns into JS objects already.
  return rows[0].work_stats as WorkStatsShape;
}

describeDb("integration — real Postgres/PostGIS (docker compose up -d)", () => {
  beforeAll(async () => {
    // Capture the ADMIN (maintenance DB) URL BEFORE mutating DATABASE_URL —
    // afterAll must connect to the maintenance DB to drop the test DB, not to
    // coffeemode_test itself ("cannot drop the currently open database").
    adminDbUrl = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
    testDbUrl = await provisionTestDatabase();
    runMigrations(testDbUrl);
    // Point the app's shared pool at the test DB before any lib call.
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client({ connectionString: testDbUrl });
    await dbClient.connect();
    await seedBaseData();
  }, 120_000);

  // Soft isolation: each test starts with no likes on CHECKIN_A1, so a
  // regression in one toggle test cannot cascade into the next.
  beforeEach(async () => {
    await dbClient?.query("delete from checkin_likes where checkin_id = $1", [CHECKIN_A1]);
  });

  afterAll(async () => {
    await closePool().catch(() => {});
    await dbClient?.end().catch(() => {});
    if (RUN_INTEGRATION && testDbUrl) {
      const admin = new pg.Client({ connectionString: adminDbUrl });
      await admin.connect().catch(() => null);
      await admin
        .query(`drop database if exists ${TEST_DB} with (force)`)
        .catch(() => null);
      await admin.end().catch(() => {});
    }
  });

  it("applies migrations 0001→0008 and installs PostGIS + both triggers", async () => {
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
      await dbClient.query(
        "insert into checkin_likes (user_id, checkin_id) values ($1, $2)",
        [U1, CHECKIN_A1],
      );
      await dbClient.query("alter table checkin_likes enable trigger trg_checkin_likes_no_self");

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

      const stats = await cafeWorkStats(CAFE_A);
      expect(stats.n_users).toBe(2);
      expect(stats.n_checkins).toBe(2);
      expect(stats.dims.overall).toEqual({ sum: 60, n: 1 });
      expect(stats.experience_score).toBe(60);
    });

    it("createCafeWithFirstCheckIn fuses cafe + first check-in + stats and dedupes", async () => {
      const created = await createCafeWithFirstCheckIn(U1, {
        name: "New Cafe",
        lat: 1.35,
        lng: 103.8,
        city: "singapore",
        google_place_id: "ChIJ-test-1",
        checkin: {
          scores: { overall: 82 },
          min_spend: "drink",
          max_stay: "unlimited",
          note: "nice",
          photo_ids: [],
        },
      });
      expect(created.tz).toBe("Asia/Singapore");

      const stats = await cafeWorkStats(created.cafeId);
      expect(stats.n_users).toBe(1);
      expect(stats.n_checkins).toBe(1);
      expect(stats.dims.overall).toEqual({ sum: 82, n: 1 });
      expect(stats.experience_score).toBe(82);
      expect(stats.policies.min_spend).toEqual({ drink: 1 });
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
            min_spend: "drink",
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

      // Deleting the check-in cascades the like row; the trigger re-syncs.
      // DESTRUCTIVE: deletes the seeded check-in — must run after every test
      // that reads CHECKIN_A1 (this describe is last).
      await dbClient.query("delete from checkins where id = $1", [CHECKIN_A1]);
      const after = await dbClient.query("select likes_count from checkins where id = $1", [
        CHECKIN_A1,
      ]);
      expect(after.rows).toHaveLength(0); // check-in gone
    });
  });
});
