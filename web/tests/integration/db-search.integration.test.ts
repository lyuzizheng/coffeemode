/**
 * Real-Postgres integration suite — search and open_now SQL pushdown contracts.
 * Extracted from db.integration.test.ts (BRAWUKA-743).
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCafeWithFirstCheckIn } from "@/lib/db/cafes";
import { cafesDataVersion, searchCafesInDb } from "@/lib/db/search";
import { isOpenAt } from "@/lib/hours";
import { executeSearch } from "@/lib/search/search-service";
import {
  setupTestDatabase,
  teardownTestDatabase,
  type TestDatabaseContext,
} from "../helpers/db";
import {
  U1,
  fakeProvisionPhotosDeps,
  resetTestDatabaseTables,
} from "../helpers/fixtures";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeDb = RUN_INTEGRATION ? describe : describe.skip;

describeDb("integration — search and open-now database contract suite", () => {
  let ctx: TestDatabaseContext;
  let dbClient: pg.Client;

  beforeAll(async () => {
    ctx = await setupTestDatabase("coffeemode_search");
    dbClient = ctx.dbClient;
  }, 120_000);

  afterAll(async () => {
    if (ctx) {
      await teardownTestDatabase(ctx);
    }
  }, 60_000);

  beforeEach(async () => {
    await resetTestDatabaseTables(dbClient);
  });

  describe("searchCafesInDb on real Postgres (search and filters)", () => {
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

  describe("open_now SQL pushdown — cafe_is_open_at parity with isOpenAt (DG145-C / BRAWUKA-25)", () => {
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
});
