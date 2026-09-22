#!/usr/bin/env node
/**
 * Export live R2 original keys referenced by the database (BRAWUKA-400).
 *
 * The orphan-original sweeper (`image-service/scripts/clean-orphan-originals.mjs`)
 * skips every key listed here, even when the object still carries a stale
 * `provision` marker (attach retry outstanding) or no marker at all (pre-#158
 * residue / direct-write drift). Live gallery originals must never be deleted:
 * `cafes.gallery[].original` + `checkins.photos[].original` for live cafes and
 * for every check-in row still in the DB — a soft-deleted check-in's photos are
 * hidden from the gallery but the DB row still references them, and a
 * soft-deleted (`deleted_at is not null`, legacy pre-DG146 tombstone) cafe's
 * live check-ins still reference theirs, so both stay protected until the row
 * itself is gone. `cafes.deleted_at` never unprotects a check-in photo.
 *
 * Usage (VPS cron / GitHub schedule, least-privilege DATABASE_URL reader):
 *   DATABASE_URL=postgres://... node scripts/export-live-image-keys.mjs > /tmp/live-keys.txt
 *   DRY_RUN=1 LIVE_KEYS_FILE=/tmp/live-keys.txt node clean-orphan-originals.mjs
 *
 * Output: one `original/<uuid>.webp` key per line, sorted, de-duplicated.
 * Keys outside `original/` (card/thumbnail) are never emitted — the sweeper
 * only lists that prefix. Failures exit non-zero with the query context.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

/** Mirrors web/lib/db/postgres.ts + web/scripts/migrate.mjs sslmode handling. */
function parseConnectionConfig(urlString) {
  const url = new URL(urlString);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const config = { connectionString: url.toString() };
  if (sslmode !== null) {
    if (sslmode === "disable") config.ssl = false;
    else if (sslmode === "allow-self-signed") config.ssl = { rejectUnauthorized: false };
    else if (
      sslmode === "require" ||
      sslmode === "prefer" ||
      sslmode === "verify-ca" ||
      sslmode === "verify-full"
    )
      config.ssl = { rejectUnauthorized: true };
    else throw new Error(`Unrecognized sslmode "${sslmode}" in DATABASE_URL.`);
  }
  return config;
}

/**
 * Every still-referenced `original/` key: live cafe galleries plus photos on
 * every check-in row still in the DB (live or soft-deleted, whatever the
 * parent cafe's `deleted_at` is — a soft-deleted cafe's live check-ins still
 * reference their photos, so their keys stay protected until the row itself
 * is gone; hard-deleted cafes cascade their check-ins away, so nothing
 * dangling needs protecting).
 *
 * NOTE: `cafes.deleted_at` is legacy-only (pre-DG146 tombstones; current
 * deletes are check-in-scoped and never write it) — but the export must not
 * depend on that assumption. If a future path soft-deletes a cafe again, its
 * check-ins' keys stay protected here.
 */
const LIVE_KEYS_SQL = `
select distinct elem->>'original' as key
from (
  select gallery as arr from cafes where deleted_at is null
  union all
  select c.photos as arr
  from checkins c
  where c.deleted_at is null
  union all
  select c.photos as arr
  from checkins c
  where c.deleted_at is not null
) t,
jsonb_array_elements(coalesce(t.arr, '[]'::jsonb)) elem
where elem->>'original' like 'original/%'
`;

export function isOriginalKey(value) {
  return typeof value === "string" && value.startsWith("original/");
}

export async function collectLiveKeys(client) {
  const { rows } = await client.query(LIVE_KEYS_SQL);
  const keys = new Set();
  for (const row of rows) {
    if (isOriginalKey(row.key)) keys.add(row.key);
  }
  return [...keys].sort();
}

async function main() {
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
  const client = new pg.Client(parseConnectionConfig(rawDatabaseUrl));
  await client.connect();
  try {
    const keys = await collectLiveKeys(client);
    for (const key of keys) console.log(key);
    console.error(`export-live-image-keys: exported ${keys.length} live original key(s)`);
  } finally {
    await client.end();
  }
}

// Run as CLI when executed directly (import.meta.main is not stable yet).
const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entry && fileURLToPath(import.meta.url) === entry) {
  main().catch((err) => {
    console.error("export-live-image-keys failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
