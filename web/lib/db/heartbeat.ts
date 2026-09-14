import "server-only";

import { query } from "./postgres";

/**
 * Keepalive probe (BRAWUKA-284): the cheapest real database round-trip.
 * `GET /api/heartbeat` runs this so the Supabase free-tier staging project
 * sees genuine activity; a static JSON response would not count. The
 * `heartbeat` select label keeps the probe identifiable in
 * `pg_stat_activity` without changing its cost.
 */
export async function pingDatabase(): Promise<void> {
  await query("select 1 as heartbeat");
}
