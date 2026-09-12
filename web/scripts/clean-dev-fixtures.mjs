import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
/**
 * CoffeeMode dev-database fixture cleaner (BRAWUKA-216).
 *
 * Deterministic test fixtures (`b0000000-*` journey mock-dataset,
 * `c0000000-*` HTTP lifecycle users, plus the reserved `a0000000-*` /
 * `d0000000-*` families) must never live in the configured dev database:
 * `check:visual` renders real cafe covers, and fixture R2 keys resolve to the
 * production image host, which fails locally as console errors. The fail-closed
 * seed guard (`scripts/lib/seed-guard.mjs`, `assertSafeSeedTarget` in
 * `web/tests/helpers/db.ts`) prevents new pollution; this script removes
 * existing rows idempotently.
 *
 * Never touched: the pre-existing `a0eebc99-*` dev rows (e.g. the Repro cafe),
 * the `00000000-*` service account seeded by migration 0016, and `e2e00000-*`
 * rows owned (and self-cleaned) by `scripts/e2e-smoke.mjs`.
 *
 * Safety: default mode is dry-run (counts only, deletes nothing). Non-local
 * hosts require `ALLOW_REMOTE_INTEGRATION_DB=1`, mirroring
 * `cleanup-stale-test-dbs.mjs`. Deletes run in one transaction in dependency
 * order (checkins/navigations before cafes before profiles; checkin_likes and
 * image_upload_intents follow via `on delete cascade`).
 *
 * Usage:
 *   node scripts/clean-dev-fixtures.mjs [--database-url <url>] [--apply] [--verbose]
 *   DATABASE_URL=postgres://... node scripts/clean-dev-fixtures.mjs --apply
 */

const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

// Deterministic fixture id families (uuid text prefix + "-"). Keep in sync
// with web/tests/fixtures/mock-dataset.ts (b0000000-*) and
// web/tests/helpers/http-client.ts HTTP_USER_IDS (c0000000-*).
const FIXTURE_PREFIXES = ["b0000000-", "c0000000-", "a0000000-", "d0000000-"];

export function isFixtureId(id) {
  if (typeof id !== "string") return false;
  return FIXTURE_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function fixturePatterns() {
  return FIXTURE_PREFIXES.map((prefix) => `${prefix}%`);
}

function showHelp() {
  console.log(`
CoffeeMode dev-database fixture cleaner (BRAWUKA-216)

Usage:
  node scripts/clean-dev-fixtures.mjs [options]

Options:
  --database-url <url>   Target connection string (default: $DATABASE_URL or local dev DB)
  --apply                Actually delete fixture rows (default: dry-run, count only)
  --verbose              List every matched id
  -h, --help             Show this help message and exit

Safety:
  Default is dry-run: counts fixture rows, deletes nothing. Non-local hosts
  require ALLOW_REMOTE_INTEGRATION_DB=1. Only b0000000-/c0000000-/a0000000-/
  d0000000- ids are ever candidates; a0eebc99-* dev rows, the service account,
  and e2e00000-* rows are never matched. --apply deletes in one transaction.
`.trim());
}

function parseArgs(argv) {
  const opts = { databaseUrl: null, apply: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      showHelp();
      process.exit(0);
    } else if (arg === "--database-url") {
      opts.databaseUrl = argv[++i];
      if (!opts.databaseUrl) {
        console.error("--database-url requires a value");
        process.exit(1);
      }
    } else if (arg === "--apply") {
      opts.apply = true;
    } else if (arg === "--verbose") {
      opts.verbose = true;
    } else {
      console.error(`Unknown option: ${arg} (see --help)`);
      process.exit(1);
    }
  }
  return opts;
}

function assertRemoteOptIn(raw) {
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname) && process.env.ALLOW_REMOTE_INTEGRATION_DB !== "1") {
    console.error(
      `Refusing fixture cleanup against non-local host ${url.hostname}; ` +
        `set ALLOW_REMOTE_INTEGRATION_DB=1 only for an explicitly disposable test server`,
    );
    process.exit(1);
  }
  return url.toString();
}

async function inspectFixtures(client) {
  const patterns = fixturePatterns();
  const like = "id::text LIKE ANY ($1)";
  const cafes = await client.query(`SELECT id FROM cafes WHERE ${like}`, [patterns]);
  const profiles = await client.query(`SELECT id FROM profiles WHERE ${like}`, [patterns]);
  const cafeIds = cafes.rows.map((row) => row.id);
  const profileIds = profiles.rows.map((row) => row.id);
  const checkins = await client.query(
    `SELECT id FROM checkins WHERE cafe_id = ANY ($1::uuid[]) OR user_id = ANY ($2::uuid[])`,
    [cafeIds, profileIds],
  );
  const checkinIds = checkins.rows.map((row) => row.id);
  const likes = await client.query(`SELECT id FROM checkin_likes WHERE checkin_id = ANY ($1::uuid[])`, [checkinIds]);
  const navigations = await client.query(
    `SELECT id FROM navigations WHERE cafe_id = ANY ($1::uuid[]) OR user_id = ANY ($2::uuid[])`,
    [cafeIds, profileIds],
  );
  return { cafeIds, profileIds, checkinIds, likeIds: likes.rows.map((row) => row.id), navigationIds: navigations.rows.map((row) => row.id) };
}

function printReport(found, verbose) {
  console.log(
    `fixture rows: cafes=${found.cafeIds.length} profiles=${found.profileIds.length} ` +
      `checkins=${found.checkinIds.length} likes=${found.likeIds.length} navigations=${found.navigationIds.length}`,
  );
  if (verbose) {
    for (const [label, ids] of [
      ["cafe", found.cafeIds],
      ["profile", found.profileIds],
      ["checkin", found.checkinIds],
      ["like", found.likeIds],
      ["navigation", found.navigationIds],
    ]) {
      for (const id of ids) console.log(`  [fixture-${label}] ${id}`);
    }
  }
}

async function deleteFixtures(client, found) {
  await client.query("BEGIN");
  try {
    const checkins = await client.query(
      `DELETE FROM checkins WHERE cafe_id = ANY ($1::uuid[]) OR user_id = ANY ($2::uuid[])`,
      [found.cafeIds, found.profileIds],
    );
    const navigations = await client.query(
      `DELETE FROM navigations WHERE cafe_id = ANY ($1::uuid[]) OR user_id = ANY ($2::uuid[])`,
      [found.cafeIds, found.profileIds],
    );
    const cafes = await client.query(`DELETE FROM cafes WHERE id = ANY ($1::uuid[])`, [found.cafeIds]);
    const profiles = await client.query(`DELETE FROM profiles WHERE id = ANY ($1::uuid[])`, [found.profileIds]);
    await client.query("COMMIT");
    return { checkins: checkins.rowCount, navigations: navigations.rowCount, cafes: cafes.rowCount, profiles: profiles.rowCount };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const targetUrl = assertRemoteOptIn(raw);
  const targetName = databaseNameFromTarget(targetUrl);

  const client = new pg.Client({ connectionString: targetUrl });
  await client.connect();
  try {
    const found = await inspectFixtures(client);
    printReport(found, opts.verbose);
    const total = found.cafeIds.length + found.profileIds.length + found.checkinIds.length;
    if (total === 0) {
      console.log(`No fixture rows in database "${targetName}"; nothing to do.`);
      return;
    }
    if (!opts.apply) {
      console.log(`Dry-run: ${total} fixture row(s) would be deleted from database "${targetName}". Re-run with --apply.`);
      return;
    }
    const deleted = await deleteFixtures(client, found);
    console.log(
      `Deleted from database "${targetName}": checkins=${deleted.checkins} navigations=${deleted.navigations} ` +
        `cafes=${deleted.cafes} profiles=${deleted.profiles} (likes/intents followed via cascade).`,
    );
  } finally {
    // Benign: best-effort connection termination on script exit.
    await client.end().catch(() => {});
  }
}

function databaseNameFromTarget(raw) {
  try {
    return decodeURIComponent(new URL(raw).pathname.replace(/^\/+/, "")) || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

const invokedDirectly =
  process.argv[1] != null &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
