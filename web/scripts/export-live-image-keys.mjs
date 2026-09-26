#!/usr/bin/env node
/**
 * Export live R2 original keys referenced by the database (BRAWUKA-400,
 * live-only since BRAWUKA-699).
 *
 * The orphan-original sweeper (`image-service/scripts/clean-orphan-originals.mjs`)
 * skips every key listed here, even when the object still carries a stale
 * `provision` marker (attach retry outstanding) or no marker at all (pre-#158
 * residue / direct-write drift). Live gallery originals must never be deleted:
 * `cafes.gallery[].original` on live cafes + `checkins.photos[].original` on
 * LIVE check-ins only (`deleted_at is null`, whatever the parent cafe's
 * `deleted_at` is — a soft-deleted cafe's live check-ins still reference
 * theirs). A soft-deleted check-in's photos are hidden from the gallery, so
 * once the photo-cleanup delete leg (`selectLivePhotoReferences`, BRAWUKA-433)
 * confirms no live row names them, this export must not re-protect them:
 * tombstone-only keys converge to deletion through the sweeper instead of
 * leaking forever. `cafes.deleted_at` never unprotects a check-in photo.
 *
 * Usage (VPS cron / GitHub schedule, least-privilege DATABASE_URL reader):
 *   DATABASE_URL=postgres://... node scripts/export-live-image-keys.mjs > /tmp/live-keys.txt.new && mv /tmp/live-keys.txt.new /tmp/live-keys.txt
 *   DRY_RUN=1 LIVE_KEYS_FILE=/tmp/live-keys.txt node clean-orphan-originals.mjs
 *
 * Output — a complete export artifact (BRAWUKA-757), not just a key list:
 * one `original/<uuid>.webp` key per line, sorted, de-duplicated, closed by a
 * final `# live-keys v1 total=<N>` trailer. The sweeper refuses any non-empty
 * file that does not parse against that contract, so an interrupted run (a
 * valid prefix of keys with no trailer) can never authorize deletions.
 * Keys outside `original/` (card/thumbnail) are never emitted — the sweeper
 * only lists that prefix. Failures exit non-zero with the query context.
 * Publish with the atomic rename above so a killed export never leaves a
 * half-written file at the path the sweeper reads.
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
 * LIVE check-ins only (BRAWUKA-699 live-only, aligned with
 * `selectLivePhotoReferences`). Whatever the parent cafe's `deleted_at` is —
 * a soft-deleted cafe's live check-ins still reference their photos, so
 * their keys stay protected until the row itself is gone; hard-deleted cafes
 * cascade their check-ins away, so nothing dangling needs protecting.
 * Tombstoned check-ins (`deleted_at is not null`) are deliberately excluded:
 * their photos are hidden from the gallery and the post-commit delete leg
 * owns them, so re-protecting them here would leak the objects forever.
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
  select photos as arr
  from checkins
  where deleted_at is null
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
    // Completeness trailer (BRAWUKA-757): printed only after every key made
    // it to stdout, so a truncated/interrupted export is detectable — the
    // sweeper refuses any file without it (parseLiveKeys).
    console.log(`# live-keys v1 total=${keys.length}`);
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
