/**
 * Shared Postgres DB fixture management for CoffeeMode E2E and LHCI runners.
 * Provides deterministic user, cafe, and check-in records with idempotent seeding and self-cleaning teardown.
 */
import pg from "pg";
import { applyMigrations } from "../migrate.mjs";

export const E2E_USER_ID = "e2e00000-0000-4000-a000-000000000001";
export const E2E_CAFE_ID = "e2e00000-0000-4000-a000-000000000002";
export const E2E_CHECKIN_ID = "e2e00000-0000-4000-a000-000000000003";

export const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

export async function setupDbFixtures({
  dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  tag = "[E2E]",
} = {}) {
  let dbClient = null;
  try {
    dbClient = new pg.Client({ connectionString: dbUrl });
    await dbClient.connect();
    await applyMigrations(dbClient);
    // Clean any prior run residuals
    await cleanupDbFixtures(dbClient);

    await dbClient.query(
      `insert into profiles (id, display_name, current_city)
       values ($1, 'E2E Nomad', 'San Francisco')
       on conflict (id) do update set display_name = 'E2E Nomad', current_city = 'San Francisco'`,
      [E2E_USER_ID],
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
    return { hasDb: true, dbClient };
  } catch (err) {
    if (process.env.CI) {
      console.error(`${tag} DB fixture initialization failed in CI:`, err);
      throw err;
    }
    if (dbClient) {
      try { await dbClient.end(); } catch {}
      dbClient = null;
    }
    return { hasDb: false, dbClient: null };
  }
}

export async function cleanupDbFixtures(dbClient) {
  if (!dbClient) return;
  try {
    await dbClient.query(`delete from checkins where cafe_id = $1 or id = $2`, [E2E_CAFE_ID, E2E_CHECKIN_ID]);
    await dbClient.query(`delete from cafes where id = $1`, [E2E_CAFE_ID]);
    await dbClient.query(`delete from profiles where id = $1`, [E2E_USER_ID]);
  } catch {}
}

export async function closeDbClient(dbClient) {
  if (!dbClient) return;
  try {
    await dbClient.end();
  } catch {}
}
