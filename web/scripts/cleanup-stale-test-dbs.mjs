import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DEFAULT_DB_URL, evaluateRemoteTarget, isTestDatabaseName } from "./lib/test-db-policy.mjs";
/**
 * CafeMood stale integration-test database sweeper.
 *
 * Journey / HTTP / DB integration suites provision one database per run via
 * `web/tests/helpers/db.ts` (`{prefix}_{pid}_{uuid32}`, e.g.
 * `coffeemode_journey_dc_1234_ab12…`) and drop it in `afterAll`. A crashed or
 * killed run leaves orphans behind — on a shared staging Supabase project
 * those accumulate. This script lists (default dry-run) or drops (`--apply`)
 * databases that match the provisioned-test pattern.
 *
 * Safety rules (canonical in `scripts/lib/test-db-policy.mjs`, shared with
 * `integrationAdminUrl` in `web/tests/helpers/db.ts`):
 *   - Non-local hosts, and `host`/`hostaddr`/`socketPath` query overrides (which
 *     would connect somewhere the URL's hostname does not name), are refused by
 *     default; `ALLOW_REMOTE_INTEGRATION_DB=1` is the single explicit opt-in
 *     that lifts both.
 *   - Only names matching `^(coffeemode_.*|supa_prov_test_.*)_[0-9]+_[0-9a-f]{32}$`
 *     are ever candidates (`isTestDatabaseName`) — the pid+uuid suffix makes
 *     real databases unmatchable, and `*_template` databases never match.
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

function showHelp() {
  console.log(`
CafeMood stale integration-test database sweeper

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
  Non-local hosts are refused by default, as is a host/hostaddr/socketPath query
  override (it would dial a host the URL does not name). The single explicit
  opt-in ALLOW_REMOTE_INTEGRATION_DB=1 lifts both; policy is canonical in
  web/scripts/lib/test-db-policy.mjs. Only pid+uuid-suffixed test databases
  match; template databases and real databases never match. --apply skips
  databases with active backends. Run an unfiltered --apply only when no
  journey is in flight; use --only to scope a sweep to specific databases.
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
  const raw = opts.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const { url: adminTarget, refusal } = evaluateRemoteTarget(raw, { action: "stale-DB sweep" });
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  const admin = new pg.Client({ connectionString: adminTarget.toString() });
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
