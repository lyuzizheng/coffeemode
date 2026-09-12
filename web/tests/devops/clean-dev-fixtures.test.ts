import { execSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
} from "../helpers/db";
import { isFixtureId } from "../../scripts/clean-dev-fixtures.mjs";
import { isTestDatabaseName } from "../../scripts/cleanup-stale-test-dbs.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLEANER = path.join(REPO_ROOT, "web/scripts/clean-dev-fixtures.mjs");

// Sweeper-exclusion invariant (BRAWUKA-225): the stale test-DB sweeper
// (`cleanup-stale-test-dbs.mjs --apply`, exercised by staging-journey.test.ts
// in the same parallel vitest run) drops every zero-backend database matching
// `isTestDatabaseName`. A `coffeemode_*` temp DB here sits at zero backends
// between its short-lived connections, so the sweeper intermittently dropped
// it mid-suite ("database ... does not exist"). This prefix deliberately
// avoids the sweeper's `coffeemode_`/`supa_prov_test_` prefixes; the `it`
// below pins that so a future rename cannot reintroduce the race.
const CLEANER_DB_PREFIX = "cleaner_dev";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

function sh(cmd: string, env: Record<string, string | undefined> = {}): string {
  const next = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return execSync(cmd, { encoding: "utf8", env: next });
}

describe("Dev fixture cleaner — CLI contracts", () => {
  it("prints usage with --help", () => {
    const out = sh(`node "${CLEANER}" --help`);
    expect(out).toContain("--apply");
    expect(out).toContain("dry-run");
  });

  it("fails fast on an unknown flag", () => {
    expect(() => sh(`node "${CLEANER}" --bogus`)).toThrow();
  });

  it("refuses a non-local host without the remote opt-in (no connection attempted)", () => {
    expect(() => sh(`node "${CLEANER}" --database-url "postgres://db.example.com:5432/coffeemode"`)).toThrow(
      /non-local host/,
    );
  });

  it("matches only deterministic fixture id families", () => {
    expect(isFixtureId("b0000000-0000-4000-a000-0000000000c1")).toBe(true);
    expect(isFixtureId("c0000000-0000-4000-a000-0000000000a1")).toBe(true);
    expect(isFixtureId("a0000000-0000-4000-a000-000000000001")).toBe(true);
    expect(isFixtureId("d0000000-0000-4000-a000-000000000001")).toBe(true);
    // Never match: pre-existing dev rows, the service account, e2e rows, real uuids.
    expect(isFixtureId("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44")).toBe(false);
    expect(isFixtureId("00000000-0000-4000-a000-000000000001")).toBe(false);
    expect(isFixtureId("e2e00000-0000-4000-a000-000000000002")).toBe(false);
    expect(isFixtureId("9c0b4ef8-bb6d-4ef8-9c0b-6bb9bd380a55")).toBe(false);
    expect(isFixtureId(42)).toBe(false);
  });

  it("temp database name is never a stale-DB sweeper candidate", () => {
    // Same generator + same prefix as the real-Postgres suite below, so the
    // verdict transfers to the actual temp database.
    expect(isTestDatabaseName(makeTestDbName(CLEANER_DB_PREFIX))).toBe(false);
  });
});

describeIntegration("Dev fixture cleaner — real Postgres", () => {
  const SERVICE_ACCOUNT = "00000000-0000-4000-a000-000000000001";
  const FIXTURE_USER = "b0000000-0000-4000-a000-0000000000a1";
  const FIXTURE_LIKER = "b0000000-0000-4000-a000-0000000000a2";
  const FIXTURE_CAFE = "b0000000-0000-4000-a000-0000000000c1";
  const FIXTURE_CHECKIN = "b0000000-0000-4000-a000-0000000000d1";
  const KEEPER_USER = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77";
  const KEEPER_CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a78";

  let adminUrl = "";
  const testDb = makeTestDbName(CLEANER_DB_PREFIX);
  const testDbUrl = () => {
    const url = new URL(adminUrl);
    url.pathname = `/${testDb}`;
    return url.toString();
  };
  const count = async (table: string, id: string): Promise<number> => {
    const client = new pg.Client({ connectionString: testDbUrl() });
    await client.connect();
    try {
      const res = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
      return res.rows.length;
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    adminUrl = integrationAdminUrl();
    await provisionTestDatabase(adminUrl, testDb);
    const client = new pg.Client({ connectionString: testDbUrl() });
    await client.connect();
    try {
      await client.query(`insert into profiles (id, display_name) values ($1, 'Keeper')`, [KEEPER_USER]);
      await client.query(
        `insert into cafes (id, name, location, city, created_by, cover)
         values ($1, 'Keeper Cafe', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, 'singapore', $2, null)`,
        [KEEPER_CAFE, KEEPER_USER],
      );
      await client.query(`insert into profiles (id, display_name) values ($1, 'Fixture'), ($2, 'Fixture Liker')`, [
        FIXTURE_USER,
        FIXTURE_LIKER,
      ]);
      await client.query(
        `insert into cafes (id, name, location, city, created_by, cover)
         values ($1, 'Fixture Roastery', ST_SetSRID(ST_MakePoint(103.8, 1.35), 4326)::geography, 'singapore', $2, 'card/d0000000-test.webp')`,
        [FIXTURE_CAFE, FIXTURE_USER],
      );
      await client.query(`insert into checkins (id, cafe_id, user_id) values ($1, $2, $3)`, [
        FIXTURE_CHECKIN,
        FIXTURE_CAFE,
        FIXTURE_USER,
      ]);
      await client.query(`insert into checkin_likes (user_id, checkin_id) values ($1, $2)`, [
        FIXTURE_LIKER,
        FIXTURE_CHECKIN,
      ]);
    } finally {
      await client.end();
    }
  }, 120_000);

  afterAll(async () => {
    await cleanupIntegrationDatabase(adminUrl, testDb).catch(() => {});
  }, 60_000);

  it("dry-run reports fixture rows without deleting them", async () => {
    const out = sh(`node "${CLEANER}" --database-url "${testDbUrl()}"`);
    expect(out).toContain("cafes=1");
    expect(out).toContain("profiles=2");
    expect(out).toContain("Dry-run");
    expect(await count("cafes", FIXTURE_CAFE)).toBe(1);
    expect(await count("checkins", FIXTURE_CHECKIN)).toBe(1);
  });

  it("--apply deletes fixtures with dependents and keeps dev rows", async () => {
    const out = sh(`node "${CLEANER}" --database-url "${testDbUrl()}" --apply`);
    expect(out).toContain("cafes=1 profiles=2");
    expect(await count("cafes", FIXTURE_CAFE)).toBe(0);
    expect(await count("profiles", FIXTURE_USER)).toBe(0);
    expect(await count("checkins", FIXTURE_CHECKIN)).toBe(0);
    expect(await count("cafes", KEEPER_CAFE)).toBe(1);
    expect(await count("profiles", KEEPER_USER)).toBe(1);
    expect(await count("profiles", SERVICE_ACCOUNT)).toBe(1);
  });
});
