/**
 * @vitest-environment node
 * Helpful ranking snapshot integration (DG148, BRAWUKA-266 / #140).
 *
 * Real-Postgres, opt-in like the rest of the integration suite:
 *
 *   docker compose up -d --wait postgres
 *   RUN_INTEGRATION=1 vitest run tests/integration/helpful-ranking.integration.test.ts
 *
 * Drives the REAL nightly script (`web/scripts/snapshot-helpful-ranking.mjs`)
 * as a child process against the test database, then asserts the product
 * contract through `listPublicCheckIns` and the feed route:
 * scoring/idempotence/atomic-publish, stable 20/page paging, frozen likes,
 * live delete visibility, expired-version 410, newest untouched.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeedCursorExpiredError,
  decodeFeedCursor,
  encodeFeedCursor,
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import { softDeleteCheckIn } from "@/lib/db/checkins";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import { CAFE_A, CHECKIN_A1, U1, seedBaseData } from "../helpers/fixtures";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import { GET as feedGET } from "@/app/api/cafes/[id]/checkins/route";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(async () => null),
}));

const execFileAsync = promisify(execFile);

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeDb = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_helpful");
const SNAPSHOT_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "snapshot-helpful-ranking.mjs",
);

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

/** Run the real nightly snapshot script against the test database. */
async function runSnapshotScript(): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [SNAPSHOT_SCRIPT], {
    env: { ...process.env, DATABASE_URL: testDbUrl },
    timeout: 60_000,
  });
}

async function activeRunId(): Promise<string | null> {
  const { rows } = await dbClient.query<{ id: string }>(
    "select id from helpful_ranking_runs where status = 'active'",
  );
  return rows[0]?.id ?? null;
}

/** Seed one check-in on CAFE_A, `ageDays` old, with `likes` from fresh likers. */
async function seedRankedCheckin(ageDays: number, likes: number): Promise<string> {
  const id = randomUUID();
  await dbClient.query(
    `insert into checkins (id, cafe_id, user_id, scores, visited_at)
     values ($1, $2, $3, '{"wifi": 50}'::jsonb, now() - ($4 || ' days')::interval)`,
    [id, CAFE_A, U1, String(ageDays)],
  );
  for (let i = 0; i < likes; i++) {
    const liker = randomUUID();
    await dbClient.query("insert into profiles (id, display_name) values ($1, 'liker')", [liker]);
    await dbClient.query("insert into checkin_likes (user_id, checkin_id) values ($1, $2)", [
      liker,
      id,
    ]);
  }
  return id;
}

describeDb("integration — helpful ranking snapshot (DG148)", () => {
  beforeAll(async () => {
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
  }, 120_000);

  beforeEach(async () => {
    await dbClient.query("truncate table helpful_ranking_runs restart identity cascade");
    await dbClient.query(
      "truncate table profiles, cafes, rate_limits, image_upload_intents, navigations restart identity cascade",
    );
    await seedBaseData(dbClient);
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

  it("publishes one active run with decayed scores (half-life 14d)", async () => {
    // B: 3 likes fresh → 3.0 | C: 10 likes 28d old → 2.5 | A: 4 likes 14d old → 2.0
    const a = await seedRankedCheckin(14, 4);
    const b = await seedRankedCheckin(0, 3);
    const c = await seedRankedCheckin(28, 10);
    await runSnapshotScript();

    const run = await activeRunId();
    expect(run).not.toBeNull();
    const { rows } = await dbClient.query<{ checkin_id: string; score: number }>(
      "select checkin_id, score from helpful_ranking_entries where run_id = $1 order by score desc",
      [run],
    );
    expect(rows.map((r) => r.checkin_id)).toEqual([b, c, a, CHECKIN_A1]);
    expect(rows[0].score).toBeCloseTo(3.0, 1);
    expect(rows[1].score).toBeCloseTo(2.5, 1);
    expect(rows[2].score).toBeCloseTo(2.0, 1);
    expect(rows[3].score).toBe(0);

    const page = await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", viewerId: null });
    expect(page.checkins.map((check) => check.id)).toEqual([b, c, a, CHECKIN_A1]);
    expect(page.nextCursor).toBeNull(); // single short page — no cursor issued
  });

  it("is idempotent: a re-run publishes a new run, exactly one stays active", async () => {
    await seedRankedCheckin(0, 1);
    await runSnapshotScript();
    const first = await activeRunId();
    await runSnapshotScript();
    const second = await activeRunId();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    const { rows } = await dbClient.query<{ status: string; n: string }>(
      "select status, count(*)::int as n from helpful_ranking_runs group by status",
    );
    const byStatus = new Map(rows.map((r) => [r.status, Number(r.n)]));
    expect(byStatus.get("active")).toBe(1);
    expect(byStatus.get("building") ?? 0).toBe(0);
  });

  it("pages one snapshot stably at 20/page with v2 cursors, no dupes", async () => {
    for (let i = 0; i < 22; i++) {
      await seedRankedCheckin(0, i % 3);
    }
    await runSnapshotScript();
    const run = await activeRunId();
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", cursor, viewerId: null });
      pages += 1;
      for (const check of page.checkins) ids.push(check.id);
      if (!page.nextCursor) break;
      // Every issued cursor is bound to the serving run.
      const decoded = decodeFeedCursor(page.nextCursor, "helpful");
      expect(decoded.v).toBe(2);
      if (decoded.v === 2) expect(decoded.run).toBe(run);
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(2);
    expect(ids).toHaveLength(23); // 22 seeded + CHECKIN_A1 baseline
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("freezes likes at publication: later likes wait for the next snapshot", async () => {
    const id = await seedRankedCheckin(0, 1);
    const other = await seedRankedCheckin(0, 2);
    await runSnapshotScript();
    const before = await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", viewerId: null });
    expect(before.checkins.map((c) => c.id)).toEqual([other, id, CHECKIN_A1]);

    // 5 fresh likes land after publication — the live page must not move.
    for (let i = 0; i < 5; i++) {
      const liker = randomUUID();
      await dbClient.query("insert into profiles (id, display_name) values ($1, 'late')", [liker]);
      await dbClient.query("insert into checkin_likes (user_id, checkin_id) values ($1, $2)", [
        liker,
        id,
      ]);
    }
    const frozen = await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", viewerId: null });
    expect(frozen.checkins.map((c) => c.id)).toEqual([other, id, CHECKIN_A1]);
    expect(frozen.checkins.find((c) => c.id === id)?.likes_count).toBe(1);

    await runSnapshotScript();
    const thawed = await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", viewerId: null });
    expect(thawed.checkins.map((c) => c.id)).toEqual([id, other, CHECKIN_A1]);
  });

  it("hides check-ins deleted after publication from snapshot pages", async () => {
    const id = await seedRankedCheckin(0, 5);
    await runSnapshotScript();
    const before = await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", viewerId: null });
    expect(before.checkins.map((c) => c.id)).toContain(id);
    await softDeleteCheckIn(U1, id);
    const after = await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", viewerId: null });
    expect(after.checkins.map((c) => c.id)).not.toContain(id);
  });

  it("rejects stale-version cursors (410 typed restart) and keeps newest untouched", async () => {
    await seedRankedCheckin(0, 1);
    // Pre-snapshot v1 helpful cursor: valid while no active run exists.
    const v1 = encodeFeedCursor({ v: 1, mode: "helpful", likes: 1, visited_at: new Date().toISOString(), id: CHECKIN_A1 });
    await listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", cursor: v1, viewerId: null });

    await runSnapshotScript();
    // The same v1 cursor is now a stale version.
    await expect(
      listPublicCheckIns({ cafeId: CAFE_A, mode: "helpful", cursor: v1, viewerId: null }),
    ).rejects.toBeInstanceOf(FeedCursorExpiredError);

    await runSnapshotScript();
    const staleRun = encodeFeedCursor({
      v: 2,
      mode: "helpful",
      run: randomUUID(),
      score: 9,
      visited_at: new Date().toISOString(),
      id: CHECKIN_A1,
    });
    const res = await feedGET(
      new Request(`https://test.local/api/cafes/${CAFE_A}/checkins?mode=helpful&cursor=${staleRun}`),
      { params: Promise.resolve({ id: CAFE_A }) },
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("cursor_version_expired");

    // Newest mode never consults snapshots.
    const newest = await listPublicCheckIns({ cafeId: CAFE_A, mode: "newest", viewerId: null });
    const times = newest.checkins.map((c) => new Date(c.visited_at).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it("reclaims superseded runs older than the 7-day retention on publish", async () => {
    await seedRankedCheckin(0, 1);
    await runSnapshotScript();
    const oldId = randomUUID();
    await dbClient.query(
      `insert into helpful_ranking_runs (id, status, built_at)
       values ($1, 'superseded', now() - interval '10 days')`,
      [oldId],
    );
    await dbClient.query(
      `insert into helpful_ranking_entries (run_id, cafe_id, checkin_id, score, likes_count, visited_at)
       values ($1, $2, $3, 0, 0, now())`,
      [oldId, CAFE_A, CHECKIN_A1],
    );
    await runSnapshotScript();
    const { rows } = await dbClient.query<{ id: string }>(
      "select id from helpful_ranking_runs where id = $1",
      [oldId],
    );
    expect(rows).toHaveLength(0);
    expect(await activeRunId()).not.toBeNull();
  });
});
