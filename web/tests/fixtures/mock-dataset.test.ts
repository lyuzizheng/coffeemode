import { afterEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { SEED_DEV_DB_OPT_IN } from "../helpers/db";
import { seedMockDataset } from "./mock-dataset";

const DEV_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
const TEST_DB_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode_test_7_guard";

/** Fake harness client: answers the guard probe, records every other statement. */
function fakeClient(dbName: string, seen: string[]): pg.Client {
  return {
    query: async (text: string) => {
      seen.push(text);
      if (/current_database/i.test(text)) return { rows: [{ db_name: dbName }] };
      return { rows: [] };
    },
  } as never as pg.Client;
}

describe("seedMockDataset — fail-closed dev-database guard (BRAWUKA-216)", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env[SEED_DEV_DB_OPT_IN];
  });

  it("refuses the configured dev database before writing anything", async () => {
    process.env.DATABASE_URL = DEV_URL;
    const seen: string[] = [];
    await expect(seedMockDataset(fakeClient("coffeemode", seen))).rejects.toThrow(
      /Refusing seedMockDataset against database "coffeemode"/,
    );
    expect(seen).toHaveLength(1);
  });

  it("seeds a test database when the admin URL names the dev database", async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    const seen: string[] = [];
    await seedMockDataset(fakeClient("coffeemode_test_7_guard", seen), { configUrl: DEV_URL });
    expect(seen[0]).toMatch(/current_database/i);
    expect(seen.some((text) => /insert into profiles/i.test(text))).toBe(true);
    expect(seen.some((text) => /insert into cafes/i.test(text))).toBe(true);
  });

  it("trusts the connected database, not the config URL", async () => {
    await expect(seedMockDataset(fakeClient("coffeemode", []), { configUrl: TEST_DB_URL })).rejects.toThrow(
      /against database "coffeemode"/,
    );
  });

  it("ALLOW_SEED_DEV_DB=1 explicitly overrides the refusal", async () => {
    process.env.DATABASE_URL = DEV_URL;
    process.env[SEED_DEV_DB_OPT_IN] = "1";
    const seen: string[] = [];
    await seedMockDataset(fakeClient("coffeemode", seen));
    expect(seen.some((text) => /insert into profiles/i.test(text))).toBe(true);
  });
});
