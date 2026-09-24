/**
 * Shared Postgres DB fixture management for CafeMood E2E and LHCI runners.
 * Provides deterministic user, cafe, and check-in records with idempotent seeding and self-cleaning teardown.
 */
import pg from "pg";
import { applyMigrations } from "../migrate.mjs";
import { assertSafeSeedTarget } from "./seed-guard.mjs";

export const E2E_USER_ID = "e2e00000-0000-4000-a000-000000000001";
export const E2E_CAFE_ID = "e2e00000-0000-4000-a000-000000000002";
export const E2E_CHECKIN_ID = "e2e00000-0000-4000-a000-000000000003";
// Second fixture user (BRAWUKA-704): owns a check-in at the fixture cafe so
// the next slice's like-toggle gate has a foreign row to act on.
export const E2E_USER2_ID = "e2e00000-0000-4000-a000-000000000004";
export const E2E_CHECKIN2_ID = "e2e00000-0000-4000-a000-000000000005";

export const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

export async function setupDbFixtures({
  dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  tag = "[E2E]",
} = {}) {
  // Fail-closed (BRAWUKA-216): never seed the dev database without an explicit
  // opt-in. Runs before try/catch so the refusal is never demoted to fallback mode.
  assertSafeSeedTarget(dbUrl, { seeder: "setupDbFixtures" });
  let dbClient = null;
  try {
    dbClient = new pg.Client({ connectionString: dbUrl });
    await dbClient.connect();
    await applyMigrations(dbClient);
    // Clean any prior run residuals
    await cleanupDbFixtures(dbClient);

    await dbClient.query(
      `insert into profiles (id, display_name, current_city)
       values ($1, 'E2E Nomad', 'San Francisco'), ($2, 'E2E Regular', 'San Francisco')
       on conflict (id) do update set display_name = excluded.display_name, current_city = excluded.current_city`,
      [E2E_USER_ID, E2E_USER2_ID],
    );

    const seedWorkStats = JSON.stringify({
      n_users: 1,
      n_checkins: 1,
      dims: {
        wifi: { sum: 90, n: 1 },
        outlets: { sum: 85, n: 1 },
        seats: { sum: 80, n: 1 },
        temp: { sum: 75, n: 1 },
        coffee: { sum: 85, n: 1 },
        overall: { sum: 85, n: 1 },
      },
      policies: {
        max_stay: { "3h": 1 },
      },
      experience_score: 85,
      composite_score: 84,
      updated_at: new Date().toISOString(),
    });

    await dbClient.query(
      `insert into cafes (id, name, address, location, city, created_by, tz, gallery, work_stats)
       values (
         $1,
         'E2E Smoke Cafe',
         '123 Smoke Test Lane',
         ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography,
         'San Francisco',
         $2,
         'America/Los_Angeles',
         '[]'::jsonb,
         $3::jsonb
       )
       on conflict (id) do update set
         name = 'E2E Smoke Cafe',
         address = '123 Smoke Test Lane',
         location = ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography,
         city = 'San Francisco',
         created_by = $2,
         tz = 'America/Los_Angeles',
         gallery = '[]'::jsonb,
         work_stats = $3::jsonb`,
      [E2E_CAFE_ID, E2E_USER_ID, seedWorkStats],
    );

    await dbClient.query(
      `insert into checkins (id, cafe_id, user_id, is_creation, note, scores, max_stay, photos, visited_at)
       values (
         $1,
         $2,
         $3,
         true,
         'Great nomad setup for smoke testing with fast wifi and outlets.',
         '{"wifi": 90, "outlets": 85, "seats": 80, "temp": 75, "coffee": 85, "overall": 85}'::jsonb,
         '3h',
         '[]'::jsonb,
         now()
       )
      on conflict (id) do update set
        cafe_id = $2,
        user_id = $3,
        is_creation = true,
        note = 'Great nomad setup for smoke testing with fast wifi and outlets.',
        scores = '{"wifi": 90, "outlets": 85, "seats": 80, "temp": 75, "coffee": 85, "overall": 85}'::jsonb,
        max_stay = '3h',
        photos = '[]'::jsonb,
        visited_at = now()`,
      [E2E_CHECKIN_ID, E2E_CAFE_ID, E2E_USER_ID],
    );

    // Foreign-owned row at the same cafe: the next slice's like-toggle gate
    // acts on this check-in as user1. Non-creation so exactly one creation
    // check-in (E2E_CHECKIN_ID) exists, preserving the drawer mode contract.
    await dbClient.query(
      `insert into checkins (id, cafe_id, user_id, is_creation, note, scores, max_stay, photos, visited_at)
       values (
         $1,
         $2,
         $3,
         false,
         'Second regular here for the like-toggle gate.',
         '{"wifi": 80, "outlets": 75, "seats": 85, "temp": 70, "coffee": 80, "overall": 80}'::jsonb,
         '2h',
         '[]'::jsonb,
         now()
       )
       on conflict (id) do update set
         cafe_id = $2,
         user_id = $3,
         is_creation = false,
         note = 'Second regular here for the like-toggle gate.',
         scores = '{"wifi": 80, "outlets": 75, "seats": 85, "temp": 70, "coffee": 80, "overall": 80}'::jsonb,
         max_stay = '2h',
         photos = '[]'::jsonb,
         visited_at = now()`,
      [E2E_CHECKIN2_ID, E2E_CAFE_ID, E2E_USER2_ID],
    );
    return { hasDb: true, dbClient };
  } catch (err) {
    if (process.env.CI) {
      console.error(`${tag} DB fixture initialization failed in CI:`, err);
      throw err;
    }
    // Local fallback stays non-fatal (no-DB mode), but the reason must be
    // visible — a cleanup failure here means residual fixture rows, and a
    // silent skip is how they accumulated unnoticed (BRAWUKA-629).
    console.warn(`${tag} DB fixture initialization failed; running without DB:`, err?.message ?? err);
    if (dbClient) {
      try {
        await dbClient.end();
      } catch {
        // Benign: best-effort client termination during setup failure teardown.
      }
      dbClient = null;
    }
    return { hasDb: false, dbClient: null };
  }
}

export async function cleanupDbFixtures(dbClient) {
  if (!dbClient) return;
  // FK-safe order inside one transaction (BRAWUKA-629): profiles is referenced
  // without cascade by cafes.created_by, checkins.user_id and
  // navigations.user_id, so the profile rows must go last — and cafes are
  // deleted by either fixture creator, not just E2E_CAFE_ID, so residual
  // fixture cafes from earlier crashed runs cannot block the profile delete.
  // checkin_likes and image_upload_intents follow via `on delete cascade`.
  // A failure here leaves fixture rows behind, so it throws: callers surface
  // it as a run failure instead of the old warn-and-accumulate behavior.
  try {
    await dbClient.query("BEGIN");
    await dbClient.query(`delete from cafes where id = $1 or created_by = any ($2::uuid[])`, [
      E2E_CAFE_ID,
      [E2E_USER_ID, E2E_USER2_ID],
    ]);
    await dbClient.query(`delete from checkins where user_id = any ($1::uuid[])`, [
      [E2E_USER_ID, E2E_USER2_ID],
    ]);
    await dbClient.query(`delete from navigations where user_id = any ($1::uuid[])`, [
      [E2E_USER_ID, E2E_USER2_ID],
    ]);
    await dbClient.query(`delete from profiles where id = any ($1::uuid[])`, [
      [E2E_USER_ID, E2E_USER2_ID],
    ]);
    await dbClient.query("COMMIT");
  } catch (err) {
    try {
      await dbClient.query("ROLLBACK");
    } catch {
      // Benign: rollback failure means the connection is already broken.
    }
    throw new Error(`[e2e-fixtures] cleanupDbFixtures failed to delete rows: ${err?.message ?? err}`);
  }
}

/**
 * Teardown for runner exits: cleanup + close, returning the cleanup error (or
 * null) so the caller decides how to surface it — `failures` list, exit code.
 * The client is always closed; a cleanup failure never leaks the connection.
 */
export async function teardownDbFixtures(dbClient) {
  if (!dbClient) return null;
  let err = null;
  try {
    await cleanupDbFixtures(dbClient);
  } catch (e) {
    err = e;
  }
  await closeDbClient(dbClient);
  return err;
}
export async function closeDbClient(dbClient) {
  if (!dbClient) return;
  try {
    await dbClient.end();
  } catch {
    // Benign: best-effort close; client may already be disconnected.
  }
}
