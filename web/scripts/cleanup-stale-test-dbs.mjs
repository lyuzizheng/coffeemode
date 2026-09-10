import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
/**
 * CoffeeMode stale integration-test database sweeper.
 *
 * Journey / HTTP / DB integration suites provision one database per run via
 * `web/tests/helpers/db.ts` (`{prefix}_{pid}_{uuid32}`, e.g.
 * `coffeemode_journey_dc_1234_ab12…`) and drop it in `afterAll`. A crashed or
 * killed run leaves orphans behind — on a shared staging Supabase project
 * those accumulate. This script lists (default dry-run) or drops (`--apply`)
 * databases that match the provisioned-test pattern.
 *
 * Safety rules (mirror `integrationAdminUrl` in `web/tests/helpers/db.ts`):
 *   - Non-local hosts require `ALLOW_REMOTE_INTEGRATION_DB=1`.
 *   - Only names matching `^(coffeemode_.*|supa_prov_test_.*)_[0-9]+_[0-9a-f]{32}$`
 *     are ever candidates — the pid+uuid suffix makes real databases
 *     unmatchable, and `*_template` databases never match (no suffix).
 *   - `--apply` drops only candidates with zero backends
 *     (`pg_stat_activity`), so a database still being provisioned is skipped.
 *   - Default mode is dry-run: lists candidates, drops nothing.
 *   - Run only when no journey is in flight against the same server.
 *
 * Usage:
 *   node scripts/cleanup-stale-test-dbs.mjs [--database-url <url>] [--apply] [--verbose]
 *   DATABASE_URL=postgres://... node scripts/cleanup-stale-test-dbs.mjs --apply
 */

const DEFAULT_DATABASE_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);

// Must stay in sync with `makeTestDbName` prefixes in web/tests/helpers/db.ts
// plus the journey/http suites: every production prefix starts with one of these.
const PREFIXES = ["coffeemode_", "supa_prov_test_"];
const TEST_DB_PATTERN = /^[a-z0-9_]+_[0-9]+_[0-9a-f]{32}$/;

function showHelp() {
  console.log(`
CoffeeMode stale integration-test database sweeper

Usage:
  node scripts/cleanup-stale-test-dbs.mjs [options]

Options:
  --database-url <url>   Admin connection string (default: $DATABASE_URL or local dev DB)
  --apply                Actually drop candidates (default: dry-run, list only)
  --verbose              Log each inspected database
  -h, --help             Show this help message and exit

Safety:
  Non-local hosts require ALLOW_REMOTE_INTEGRATION_DB=1 (same vocabulary as
  web/tests/helpers/db.ts). Only pid+uuid-suffixed test databases match;
  template databases and real databases never match. --apply skips databases
  with active backends. Run only when no journey is in flight.
`.trim());
}

function parseArgs(argv) {
  const opts = { databaseUrl: null, apply: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      showHelp();
      process.exit(0);
    } else if (a === "--database-url") {
      opts.databaseUrl = argv[++i];
      if (!opts.databaseUrl) {
        console.error("--database-url requires a value");
        process.exit(1);
      }
    } else if (a === "--apply") {
      opts.apply = true;
    } else if (a === "--verbose") {
      opts.verbose = true;
    } else {
      console.error(`Unknown option: ${a} (see --help)`);
      process.exit(1);
    }
  }
  return opts;
}

export function isTestDatabaseName(name) {
  if (typeof name !== "string") return false;
  if (!PREFIXES.some((p) => name.startsWith(p))) return false;
  if (name.endsWith("_template")) return false;
  return TEST_DB_PATTERN.test(name);
}

function assertRemoteOptIn(raw) {
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname) && process.env.ALLOW_REMOTE_INTEGRATION_DB !== "1") {
    console.error(
      `Refusing stale-DB sweep against non-local host ${url.hostname}; ` +
        `set ALLOW_REMOTE_INTEGRATION_DB=1 only for an explicitly disposable test server`,
    );
    process.exit(1);
  }
  return url.toString();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const raw = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const adminUrl = assertRemoteOptIn(raw);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query(`
      SELECT d.datname, COALESCE(s.numbackends, 0) AS backends
      FROM pg_database d
      LEFT JOIN pg_stat_database s ON s.datname = d.datname
      WHERE d.datistemplate = false
      ORDER BY d.datname
    `);
    const candidates = rows.filter(
      (r) => isTestDatabaseName(r.datname) && Number(r.backends) === 0,
    );
    const busy = rows.filter((r) => isTestDatabaseName(r.datname) && Number(r.backends) > 0);
    const busyNames = new Set(busy.map((r) => r.datname));
    for (const r of rows) {
      if (opts.verbose || isTestDatabaseName(r.datname)) {
        const state = busyNames.has(r.datname) ? "[busy-skip]" : isTestDatabaseName(r.datname) ? "[candidate]" : "[keep]";
        console.log(`${state} ${r.datname} (backends=${r.backends})`);
      }
    }
    if (candidates.length === 0) {
      console.log(busy.length > 0 ? `No droppable test databases found (${busy.length} busy, skipped).` : "No stale test databases found.");
      return;
    }
    if (!opts.apply) {
      console.log(`Dry-run: ${candidates.length} stale test database(s) would be dropped. Re-run with --apply.`);
      return;
    }
    for (const r of candidates) {
      const quoted = `"${r.datname.replaceAll('"', '""')}"`;
      await admin.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
      console.log(`Dropped ${r.datname}`);
    }
    console.log(`Done: dropped ${candidates.length} stale test database(s).`);
  } finally {
    await admin.end().catch(() => {});
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
