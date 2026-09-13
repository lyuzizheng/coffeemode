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
 *   - `--only <name>` (repeatable) narrows the sweep to exact database names;
 *     the `isTestDatabaseName` gate still applies, so it can never widen scope.
 *     The vitest suite uses it so a parallel run cannot drop another suite's
 *     live scratch database (BRAWUKA-255).
 *   - Default mode is dry-run: lists candidates, drops nothing.
 *   - Run an unfiltered `--apply` only when no journey is in flight.
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
  --only <name>          Restrict candidates to exact database name(s); repeatable.
                         Names failing the test-database pattern are ignored.
  --verbose              Log each inspected database
  -h, --help             Show this help message and exit

Safety:
  Non-local hosts require ALLOW_REMOTE_INTEGRATION_DB=1 (same vocabulary as
  web/tests/helpers/db.ts). Only pid+uuid-suffixed test databases match;
  template databases and real databases never match. --apply skips databases
  with active backends. Run an unfiltered --apply only when no journey is in
  flight; use --only to scope a sweep to specific databases.
`.trim());
}

function parseArgs(argv) {
  const opts = { databaseUrl: null, apply: false, verbose: false, only: [] };
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
    } else if (a === "--only") {
      const name = argv[++i];
      if (!name) {
        console.error("--only requires a value");
        process.exit(1);
      }
      opts.only.push(name);
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
/**
 * Split inspected databases into droppable candidates and busy test databases,
 * honoring the optional --only scope. Rows outside the test-name pattern or the
 * --only set are never candidates.
 */
function partitionTestDatabases(rows, onlyNames) {
  const onlySet = new Set(onlyNames);
  for (const name of onlySet) {
    if (!isTestDatabaseName(name)) {
      console.warn(`Ignoring --only ${name}: not a provisioned test-database name.`);
    }
  }
  const inScope = (name) => onlySet.size === 0 || onlySet.has(name);
  const candidates = [];
  const busy = [];
  for (const r of rows) {
    if (!isTestDatabaseName(r.datname) || !inScope(r.datname)) continue;
    if (Number(r.backends) === 0) {
      candidates.push(r);
    } else {
      busy.push(r);
    }
  }
  return { candidates, busy, inScope };
}

/** Log each inspected database with its sweep disposition. */
function reportDatabaseStates(rows, busyNames, inScope, verbose) {
  for (const r of rows) {
    if (verbose || isTestDatabaseName(r.datname)) {
      const state = busyNames.has(r.datname)
        ? "[busy-skip]"
        : isTestDatabaseName(r.datname) && inScope(r.datname)
          ? "[candidate]"
          : "[keep]";
      console.log(`${state} ${r.datname} (backends=${r.backends})`);
    }
  }
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
    const { candidates, busy, inScope } = partitionTestDatabases(rows, opts.only);
    const busyNames = new Set(busy.map((r) => r.datname));
    reportDatabaseStates(rows, busyNames, inScope, opts.verbose);
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
    // Benign: best-effort admin connection termination on script exit.
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
