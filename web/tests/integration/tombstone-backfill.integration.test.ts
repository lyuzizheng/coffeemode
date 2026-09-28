import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCheckIn, softDeleteCheckIn } from "@/lib/db/checkins";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import { collectTombstoneOnlyPhotoIds } from "../../scripts/backfill-tombstone-photo-deletes.mjs";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  CAFE_A,
  U1,
  U2,
  fakeProvisionPhotosDeps,
  seedBaseData,
} from "../helpers/fixtures";

// BRAWUKA-699: the tombstone backfill converges pre-#694 residue — photos
// referenced ONLY by soft-deleted check-ins. Live rows sharing a photo keep
// it; tombstone-only ids are enumerated for the image-service delete leg.
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeBackfill = RUN_INTEGRATION ? describe : describe.skip;

const TEST_DB = makeTestDbName("coffeemode_backfill");

let testDbUrl = "";
let adminDbUrl = "";
let dbClient!: pg.Client;
const previousDatabaseUrl = process.env.DATABASE_URL;

describeBackfill("integration — tombstone backfill enumeration (BRAWUKA-699)", () => {
  beforeAll(async () => {
    adminDbUrl = integrationAdminUrl();
    testDbUrl = testDatabaseUrl(adminDbUrl, TEST_DB);
    await provisionTestDatabase(adminDbUrl, TEST_DB);
    process.env.DATABASE_URL = testDbUrl;
    // The shared pool binds DATABASE_URL lazily on first use: reset it so
    // the lib calls below hit the test DB, not a stale pool (the pool may
    // already exist if another suite file ran first in this worker).
    await closePool();
    dbClient = new pg.Client(getPoolConfig(testDbUrl));
    await dbClient.connect();
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
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "real-DB integration cleanup failed");
    }
  }, 60_000);
  // Hard isolation (mirrors db.integration.test.ts): reset mutable rows,
  // then seed the same baseline. The seed check-in is aged past the revisit
  // window (not tombstoned — it carries no photos, so it never leaks into
  // the tombstone enumeration) so test creates never collide with it.
  beforeEach(async () => {
    // A legacy self-like test elsewhere temporarily disables this trigger;
    // re-enable it before truncation so the table state is deterministic.
    await dbClient.query("alter table checkin_likes enable trigger all");
    await dbClient.query(
      "truncate table profiles, cafes, image_upload_intents, navigations restart identity cascade",
    );
    await seedBaseData(dbClient);
    await dbClient.query("update checkins set visited_at = now() - interval '25 hours'");
  });

  it("enumerates tombstone-only photos after soft-delete (pre-#694 residue shape)", async () => {
    const photoA = randomUUID();
    await recordUploadIntent(U2, photoA);
    const deps = fakeProvisionPhotosDeps();
    const created = await createCheckIn(
      U2,
      { cafe_id: CAFE_A, scores: { overall: 55 }, photo_ids: [photoA] },
      deps,
    );

    // Pre-#694 residue shape: gallery purge ran but the R2 delete leg never
    // did. `softDeleteCheckIn` with the fake (no-op R2) deps reproduces it
    // exactly — a raw `deleted_at` update would leave gallery behind, which
    // the real delete path always purges.
    await softDeleteCheckIn(U2, created.checkin_id, deps);

    await expect(collectTombstoneOnlyPhotoIds(dbClient)).resolves.toEqual([photoA]);
  });

  it("excludes tombstone photos still named by a live row (shared-photo keep)", async () => {
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

    // photoB is carried over to a second LIVE check-in (U2 has no other live
    // rows): the backfill must keep it while photoA (tombstone-only) is
    // enumerated. Tombstoning the first row purges only its own gallery
    // entries, so the live row's copy keeps photoB protected.
    const stored = (
      await dbClient.query("select photos from checkins where id = $1", [created.checkin_id])
    ).rows[0].photos as { id: string }[];
    const photoBEntry = stored.find((p) => p.id === photoB);
    expect(photoBEntry).toBeDefined();
    // A second LIVE check-in by another user (dodges the revisit window)
    // names the same photo id; by-id matching keeps it protected.
    await recordUploadIntent(U1, photoB);
    await createCheckIn(U1, { cafe_id: CAFE_A, scores: { overall: 60 }, photo_ids: [photoB] }, deps);
    await softDeleteCheckIn(U2, created.checkin_id, deps);

    await expect(collectTombstoneOnlyPhotoIds(dbClient)).resolves.toEqual([photoA]);
  });

  it("excludes tombstone photos still named by a live gallery row", async () => {
    const photoA = randomUUID();
    await recordUploadIntent(U2, photoA);
    const deps = fakeProvisionPhotosDeps();
    const created = await createCheckIn(
      U2,
      { cafe_id: CAFE_A, scores: { overall: 55 }, photo_ids: [photoA] },
      deps,
    );
    const stored = (
      await dbClient.query("select photos from checkins where id = $1", [created.checkin_id])
    ).rows[0].photos as { id: string }[];
    // Tombstone first (purges the photo from gallery), then re-add the
    // photo to the LIVE gallery manually (carry-over / referenced-by-live):
    // the backfill must keep it.
    await softDeleteCheckIn(U2, created.checkin_id, deps);
    await dbClient.query(
      `update cafes set gallery = coalesce(gallery, '[]'::jsonb) || $2::jsonb where id = $1`,
      [CAFE_A, JSON.stringify([stored[0]])],
    );

    await expect(collectTombstoneOnlyPhotoIds(dbClient)).resolves.toEqual([]);
  });

  it("empty tombstone set enumerates nothing (exit-0 shape)", async () => {
    await expect(collectTombstoneOnlyPhotoIds(dbClient)).resolves.toEqual([]);
  });

  it("softDeleteCheckIn residue converges through the same enumeration", async () => {
    // The live delete path already removes variants post-commit; this pins
    // the backfill to the same live-only semantics on its output.
    const photoA = randomUUID();
    await recordUploadIntent(U1, photoA);
    const deps = fakeProvisionPhotosDeps();
    const created = await createCheckIn(
      U1,
      { cafe_id: CAFE_A, scores: { overall: 60 }, photo_ids: [photoA] },
      deps,
    );
    await softDeleteCheckIn(U1, created.checkin_id, deps);
    await expect(collectTombstoneOnlyPhotoIds(dbClient)).resolves.toEqual([photoA]);
  });
});
