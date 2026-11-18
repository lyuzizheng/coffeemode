import { execFileSync, execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  quotedIdentifier,
  testDatabaseUrl,
} from "../helpers/db";
import { SERVICE_ACCOUNT_ID, seedBaseData } from "../helpers/fixtures";

// BRAWUKA-728: `--drill` certified failed restorations as PASSED — a nonzero
// `pg_restore` exit status was downgraded to a warning, and a failing `psql`
// count query was substituted with `0`. BRAWUKA-753 added the mirror-image
// defect: the archive probe rejected *valid* gzip backups once the decompressed
// stream exceeded the pipe buffer (pg_restore stops reading after the table of
// contents, gzip dies with SIGPIPE, `pipefail` reports 141).
//
// The first suite runs the real `scripts/devops/restore.sh` against
// deterministic local stubs: the stub decides whether `pg_restore`/`psql`
// succeed and every assertion is about the script's own verdict (exit status,
// PASSED banner, scratch-DB lifecycle). The second, integration-gated suite
// drills a real `pg_dump -Fc | gzip` archive with the real postgresql-client
// against real Postgres/PostGIS.
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RESTORE = path.join(REPO_ROOT, "scripts/devops/restore.sh");
const STAGING_URL = "postgres://stub:stub@drill.invalid:5432/postgres?sslmode=require";
const PROD_URL = "postgres://stub:stub@prod.invalid:5432/postgres?sslmode=require";
// Linux pipe capacity (64 KiB) is the threshold above which an early reader
// makes the writer block and then die of SIGPIPE.
const PIPE_BUFFER_BYTES = 64 * 1024;

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

const POSTGRES_CLIENT_TOOLS = ["pg_dump", "pg_restore", "psql"];
const hasPostgresClientTools = POSTGRES_CLIENT_TOOLS.every((bin) => {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

// `--list` is the archive-readability probe; `--version` feeds the client/server
// major comparison (lib/pg-client.sh); every other call is a restore.
// The probe returns without reading stdin, which is exactly what the real
// `pg_restore --list` does — and what made gzip die of SIGPIPE (BRAWUKA-753).
// The restore path drains its stdin first, like a real restore does.
// STUB_RESTORE_OK=0 reproduces "pg_restore exited nonzero".
const PG_RESTORE_STUB = `#!/usr/bin/env bash
set -u
printf 'pg_restore %s\\n' "$*" >> "$STUB_LOG"
case "$*" in
  *"--version"*)
    printf 'pg_restore (PostgreSQL) %s\\n' "\${STUB_PG_RESTORE_VERSION:-16.4}"
    exit 0
    ;;
  *"--list"*)
    if [ "\${STUB_ARCHIVE_READABLE:-1}" != "1" ]; then
      printf 'pg_restore: error: could not read from input file\\n' >&2
      exit 1
    fi
    # Relation baseline of the archive (BRAWUKA-1015). Empty value = a baseline
    # archive with no application relations (pre-migration snapshot).
    oid=20000
    for table in \${STUB_ARCHIVED_TABLES-cafes checkins profiles}; do
      oid=$((oid + 1))
      printf '%s; 1259 %s TABLE public %s coffeemode\\n' "$oid" "$oid" "$table"
    done
    exit 0
    ;;
esac
cat >/dev/null
if [ "\${STUB_RESTORE_OK:-1}" != "1" ]; then
  printf 'pg_restore: error: injected restore failure\\n' >&2
  exit 1
fi
exit 0
`;

// STUB_FAIL_TABLES    required tables whose count query errors (relation missing)
// STUB_JUNK_TABLES    required tables whose count query answers a non-number
// STUB_COUNTS         "cafes=12 checkins=34 profiles=5"; absent table -> 0
// STUB_SERVER_VERSION_NUM  server_version_num answer for the client-major probe (default 160004)
// STUB_POSTGIS        "missing" errors the extension check; "empty" answers with no version
// STUB_SPATIAL        "missing" errors the spatial query
// STUB_SPATIAL_COUNT  the spatial query's scalar answer (set a non-number to malform it)
const PSQL_STUB = `#!/usr/bin/env bash
set -u
printf 'psql %s\\n' "$*" >> "$STUB_LOG"
sql="$*"
for table in \${STUB_FAIL_TABLES:-}; do
  case "$sql" in
    *"FROM \\"$table\\""*) printf 'ERROR:  relation "%s" does not exist\\n' "$table" >&2; exit 3 ;;
  esac
done
for table in \${STUB_JUNK_TABLES:-}; do
  case "$sql" in
    *"FROM \\"$table\\""*) printf 'NaN\\n'; exit 0 ;;
  esac
done
case "$sql" in
  *"server_version_num"*) printf '%s\\n' "\${STUB_SERVER_VERSION_NUM:-160004}" ;;
  *"pg_terminate_backend"*) exit 0 ;;
  *"ALTER DATABASE"*) exit 0 ;;
  *"DROP DATABASE IF EXISTS"*|*"CREATE DATABASE"*) exit 0 ;;
  *"select rolsuper"*)
    if [ "\${STUB_RECOVERY_SUPER:-1}" = "1" ]; then printf 't\\n'; else printf 'f\\n'; fi
    ;;
  *"c.relowner"*) printf '0\\n' ;;
  *"pg_get_userbyid"*)
    case "$sql" in
      *"nspowner"*) printf '%s\\n' "\${STUB_SCHEMA_OWNER:-coffeemode}" ;;
      *"datdba"*) printf '%s\\n' "\${STUB_DB_OWNER:-coffeemode}" ;;
      *) printf 'coffeemode\\n' ;;
    esac
    ;;
  *"datname = '"*)
    if [ "\${STUB_TARGET_MISSING:-0}" = "1" ]; then printf '0\\n'; else printf '1\\n'; fi
    ;;
  *"c.relname = '"*)
    relation="$(printf '%s' "$sql" | sed -nE "s/.*c.relname = '([a-z_][a-z_]*)'.*/\\1/p")"
    case " \${STUB_MISSING_RELATIONS:-} " in
      *" $relation "*) printf '0\\n' ;;
      *) printf '1\\n' ;;
    esac
    ;;
  *"string_agg"*) printf '%s\\n' "\${STUB_EXTRA_RELATIONS:-}" ;;
  *'count(*) FROM "'*)
    table="$(printf '%s' "$sql" | sed -nE 's/.*FROM "([a-z_][a-z_]*)".*/\\1/p')"
    count="$(printf '%s\\n' "\${STUB_COUNTS:-}" | tr ' ' '\\n' | sed -n "s/^$table=//p")"
    printf '%s\\n' "\${count:-0}"
    ;;
  *"PostGIS_Version"*)
    case "\${STUB_POSTGIS:-ok}" in
      ok) printf '3.4 USE_GEOS=1\\n' ;;
      missing) printf 'ERROR:  function postgis_version() does not exist\\n' >&2; exit 3 ;;
      empty) ;;
      *) printf 'unexpected STUB_POSTGIS: %s\\n' "\$STUB_POSTGIS" >&2; exit 99 ;;
    esac
    ;;
  *"pg_roles"*)
    printf '%s\n' "\${STUB_OWNER_FLAGS:-coffeemode superuser=false createdb=false}"
    ;;
  *"-v ON_ERROR_STOP=1 -q"*)
    # Ownership normalization arrives on stdin, so the argv carries no SQL.
    exit 0
    ;;
  *"ST_DWithin"*)
    if [ "\${STUB_SPATIAL:-ok}" != "ok" ]; then
      printf 'ERROR:  spatial contract query failed\\n' >&2
      exit 3
    fi
    printf '%s\\n' "\${STUB_SPATIAL_COUNT:-2}"
    ;;
  *"FROM "*)
    table="$(printf '%s' "$sql" | sed -n 's/.*FROM \\([a-z_][a-z_]*\\);.*/\\1/p')"
    count="$(printf '%s\\n' "\${STUB_COUNTS:-}" | tr ' ' '\\n' | sed -n "s/^$table=//p")"
    printf '%s\\n' "\${count:-0}"
    ;;
  *)
    printf 'unexpected psql invocation: %s\\n' "$sql" >&2
    exit 99
    ;;
esac
`;

let tmpRoot = "";
let stubBin = "";
let dumpFixture = "";
let truncatedGz = "";
// A real gzip stream whose decompressed size exceeds the pipe buffer: the only
// fixture that reproduces the SIGPIPE rejection. Random bytes keep it
// incompressible, so gzip has to write every byte it reads.
let oversizedGz = "";
let runIndex = 0;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coffeemode-restore-drill-"));
  stubBin = path.join(tmpRoot, "bin");
  fs.mkdirSync(stubBin);
  for (const [name, source] of [
    ["pg_restore", PG_RESTORE_STUB],
    ["psql", PSQL_STUB],
    // Deterministic "no database container matched the URL": the fail-closed
    // client-version test must not depend on the host's Docker containers.
    ["docker", "#!/usr/bin/env bash\nexit 0\n"],
  ] as const) {
    const target = path.join(stubBin, name);
    fs.writeFileSync(target, source, { mode: 0o755 });
  }
  dumpFixture = path.join(tmpRoot, "snapshot.dump");
  fs.writeFileSync(dumpFixture, "stub archive fixture\n");
  truncatedGz = path.join(tmpRoot, "truncated.dump.gz");
  fs.writeFileSync(truncatedGz, "this is not a gzip stream\n");
  oversizedGz = path.join(tmpRoot, "oversized.dump.gz");
  fs.writeFileSync(oversizedGz, zlib.gzipSync(randomBytes(2 * 1024 * 1024)));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface DrillRun {
  status: number;
  output: string;
  invocations: string;
}

const CLEARED_ENV: Record<string, undefined> = {
  STAGING_DATABASE_URL: undefined,
  STAGING_RESTORE_URL: undefined,
  PROD_RESTORE_URL: undefined,
  RESTORE_URL: undefined,
  RESTORE_OWNER_ROLE: undefined,
  PROD_DIRECT_URL: undefined,
  PROD_DATABASE_URL: undefined,
  DATABASE_URL: undefined,
  DIRECT_URL: undefined,
  STUB_ARCHIVE_READABLE: undefined,
  STUB_RESTORE_OK: undefined,
  STUB_FAIL_TABLES: undefined,
  STUB_JUNK_TABLES: undefined,
  STUB_COUNTS: undefined,
  STUB_POSTGIS: undefined,
  STUB_SPATIAL: undefined,
  STUB_SPATIAL_COUNT: undefined,
  STUB_PG_RESTORE_VERSION: undefined,
  STUB_ARCHIVED_TABLES: undefined,
  STUB_RECOVERY_SUPER: undefined,
  STUB_TARGET_MISSING: undefined,
  STUB_MISSING_RELATIONS: undefined,
  STUB_EXTRA_RELATIONS: undefined,
  STUB_DB_OWNER: undefined,
  STUB_SCHEMA_OWNER: undefined,
  STUB_SERVER_VERSION_NUM: undefined,
  PG_CLIENT_CONTAINER: undefined,
  PG_CLIENT_CONTAINER_NAME: undefined,
  PG_CLIENT_MODE: undefined,
};

function runRestore(
  args: string[],
  overrides: Record<string, string | undefined> = {},
  options: { stubs?: boolean } = {},
): DrillRun {
  runIndex += 1;
  const logPath = path.join(tmpRoot, `invocations-${runIndex}.log`);
  fs.writeFileSync(logPath, "");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries({
    ...CLEARED_ENV,
    STAGING_DIRECT_URL: STAGING_URL,
    STUB_LOG: logPath,
    ...overrides,
  })) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  if (options.stubs !== false) env.PATH = `${stubBin}:${env.PATH ?? ""}`;

  let status = 0;
  let output = "";
  try {
    output = execSync(`bash "${RESTORE}" ${args.join(" ")}`, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? -1;
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  if (process.env.DEBUG_RESTORE === "1") console.log(output);
  return { status, output, invocations: fs.readFileSync(logPath, "utf8") };
}

// Healthy verification responses by default, so a case that expects the drill
// to reach its verdict only has to break the one thing it is about.
function runDrill(overrides: Record<string, string | undefined> = {}): DrillRun {
  return runRestore(["--env", "staging", "--file", dumpFixture, "--drill"], {
    STUB_COUNTS: "cafes=12 checkins=34 profiles=5",
    ...overrides,
  });
}

/** The database URL handed to the restore itself (not to --version/--list). */
function urlPassedToRestore(invocations: string): string {
  const match = invocations.match(/pg_restore -d (\S+)/);
  expect(match?.[1], "pg_restore never received a restore target").toBeTruthy();
  return match?.[1] ?? "";
}

function scratchDbFrom(invocations: string): string {
  const match = invocations.match(/DROP DATABASE IF EXISTS "(restore_drill_[^"]+)"/);
  expect(match?.[1], "drill never named a scratch database").toBeTruthy();
  return match?.[1] ?? "";
}

describe("Recovery drill — failure lifecycle (BRAWUKA-728)", () => {
  it("fails when pg_restore exits nonzero, and still drops the scratch database", () => {
    const run = runDrill({ STUB_RESTORE_OK: "0" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("pg_restore FAILED");
    // Cleanup is not conditional on success: the scratch DB is created and gone.
    expect(run.invocations).toContain("CREATE DATABASE");
    const scratchDb = scratchDbFrom(run.invocations);
    expect(run.invocations).toContain(`DROP DATABASE IF EXISTS "${scratchDb}"`);
  });

  it("fails closed when the host client is newer than the server and no database container matches (BRAWUKA-1015)", () => {
    const run = runDrill({
      STUB_PG_RESTORE_VERSION: "18.7",
      STUB_SERVER_VERSION_NUM: "160004",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("not loadable into an older server");
    expect(run.output).toContain("PG_CLIENT_CONTAINER");
    // Refused before any target work: no scratch database was created.
    expect(run.invocations).not.toContain("CREATE DATABASE");
  });

  it("fails when a required table is missing after an otherwise clean restore", () => {
    const run = runDrill({ STUB_FAIL_TABLES: "checkins profiles", STUB_COUNTS: "cafes=3" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("checkins");
    expect(run.output).toContain("unreadable");
  });

  it("fails when the required tables restore without any rows", () => {
    const run = runDrill({ STUB_COUNTS: "cafes=0 checkins=0 profiles=0" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("empty");
  });

  it("keeps a legitimately empty table valid as long as the restored set has rows", () => {
    const run = runDrill({ STUB_COUNTS: "cafes=5 checkins=0 profiles=0" });

    expect(run.status).toBe(0);
    expect(run.output).toContain("PASSED");
    expect(run.output).toContain("Row count: checkins=0");
    expect(run.output).toContain("Seeded content verified: 5 row(s)");
  });

  it("accepts a valid gzip archive larger than the pipe buffer (BRAWUKA-753)", () => {
    // The regression: pg_restore stops reading after the table of contents, so
    // the decompressor is left writing into a closed pipe. Rejecting this
    // archive is the defect; accepting a corrupt one would be the next defect.
    expect(fs.statSync(oversizedGz).size).toBeGreaterThan(PIPE_BUFFER_BYTES);
    const run = runRestore(["--env", "staging", "--file", oversizedGz, "--drill"], {
      STUB_COUNTS: "cafes=12 checkins=34 profiles=5",
    });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Archive verified: 3 application relation(s) in its table of contents.");
    expect(run.output).toContain("PASSED");
  });

  it("fails on an unreadable gzip stream before touching the drill target", () => {
    const run = runRestore(["--env", "staging", "--file", truncatedGz, "--drill"]);

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("not a readable pg_restore archive");
    // The archive is rejected in step 2, so no scratch database is ever created.
    expect(run.invocations).not.toContain("CREATE DATABASE");
  });

  it("fails when pg_restore cannot read the archive table of contents", () => {
    const run = runDrill({ STUB_ARCHIVE_READABLE: "0" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("not a readable pg_restore archive");
    expect(run.invocations).not.toContain("CREATE DATABASE");
  });

  it("fails when the PostGIS extension check fails", () => {
    const run = runDrill({ STUB_POSTGIS: "missing", STUB_COUNTS: "cafes=3 checkins=2 profiles=1" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("PostGIS extension check FAILED");
    expect(run.invocations).toContain("DROP DATABASE IF EXISTS");
  });

  it("fails when the PostGIS version query answers without a version", () => {
    const run = runDrill({ STUB_POSTGIS: "empty" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("PostGIS is not installed");
    expect(run.invocations).toContain("DROP DATABASE IF EXISTS");
  });

  it("fails when the spatial contract query fails", () => {
    // Counts must succeed, or the run would stop at the all-empty guard and
    // never reach ST_DWithin — the assertion would then pass for the wrong
    // reason (BRAWUKA-754).
    const run = runDrill({
      STUB_SPATIAL: "missing",
      STUB_COUNTS: "cafes=3 checkins=2 profiles=1",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.invocations).toContain("ST_DWithin");
    expect(run.output).toContain("PostGIS spatial query check FAILED");
    expect(run.invocations).toContain("DROP DATABASE IF EXISTS");
  });

  it("fails when the spatial query answers with a non-number", () => {
    const run = runDrill({ STUB_SPATIAL_COUNT: "NaN" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.invocations).toContain("ST_DWithin");
    expect(run.output).toContain("no numeric result");
    expect(run.invocations).toContain("DROP DATABASE IF EXISTS");
  });

  it("fails when a row count is not a number", () => {
    const run = runDrill({ STUB_JUNK_TABLES: "cafes" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("not a number");
  });

  it("fails when the restored schema owner does not match the application role", () => {
    const run = runDrill({ STUB_COUNTS: "cafes=12 checkins=34 profiles=5", STUB_SCHEMA_OWNER: "postgres" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("schema 'public' is owned by 'postgres'");
  });

  it("passes a valid fixture restore and drops the scratch database", () => {
    const run = runDrill({ STUB_COUNTS: "cafes=12 checkins=34 profiles=5" });

    expect(run.status).toBe(0);
    expect(run.output).toContain("PASSED");
    expect(run.output).toContain("cafes=12");
    expect(run.invocations).toContain("ST_DWithin");
    const scratchDb = scratchDbFrom(run.invocations);
    expect(run.invocations).toContain(`CREATE DATABASE "${scratchDb}"`);
    expect(run.output).toContain("Scratch drill database removed");
    expect(run.invocations).toContain(`DROP DATABASE IF EXISTS "${scratchDb}"`);
  });

  it("applies the same strict verification to a live restore", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--yes"], {
      PROD_RESTORE_URL: PROD_URL,
      STUB_FAIL_TABLES: "profiles",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("profiles");
    expect(run.output).toContain("unreadable");
  });

  // ADR-0010 §3: restores run as the authorized recovery role. The application
  // role cannot drop/recreate the PostGIS extension, so a live restore must not
  // silently fall back to the app URL — it would half-apply, then exit 1.
  it("refuses a live restore without the authorized recovery role", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--yes"], {
      PROD_DIRECT_URL: PROD_URL,
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Authorized recovery role");
    expect(run.output).toContain("PROD_RESTORE_URL");
    expect(run.output).not.toContain("Database restore command executed");
  });

  it("recreates the target database only with --recreate and --yes", () => {
    const refused = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate"], {
      PROD_RESTORE_URL: PROD_URL,
    });
    expect(refused.status).not.toBe(0);
    expect(refused.output).toContain("requires --yes");

    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate", "--yes"], {
      PROD_RESTORE_URL: "postgres://stub:stub@prod.invalid:5432/coffeemode?sslmode=require",
      STUB_COUNTS: "cafes=12 checkins=34 profiles=5",
    });
    expect(run.status).toBe(0);
    // BRAWUKA-1015 P0: the live database is not dropped before its replacement
    // passes verification. Restore goes into `coffeemode__restore_*`, then the
    // verified copy takes the live name and the old one is retired.
    expect(run.invocations).not.toContain(`DROP DATABASE IF EXISTS "coffeemode" WITH (FORCE)`);
    const replacement = run.invocations.match(/CREATE DATABASE "(coffeemode__restore_[^"]+)" OWNER "coffeemode"/);
    expect(replacement, "no replacement database was created").not.toBeNull();
    const replacementDb = replacement?.[1] ?? "";
    expect(urlPassedToRestore(run.invocations)).toContain(`/${replacementDb}`);
    // Atomic promotion: both renames and their commit live in one psql -c.
    const promotion = run.invocations
      .split("\n")
      .find((line) => line.includes("BEGIN;") && line.includes("COMMIT;"));
    expect(promotion, "no single-transaction promotion was issued").toBeDefined();
    expect(promotion ?? "").toContain(`ALTER DATABASE "coffeemode" RENAME TO "coffeemode__retired_`);
    expect(promotion ?? "").toContain(`ALTER DATABASE "${replacementDb}" RENAME TO "coffeemode"`);
    expect(run.output).toContain("Application objects in 'public' are owned by 'coffeemode'");
    expect(run.output).toContain("Promotion complete");
    expect(run.invocations).toContain(`DROP DATABASE "coffeemode__retired_`);
  });

  it("refuses a recovery role that is not a superuser before any destructive SQL", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate", "--yes"], {
      PROD_RESTORE_URL: "postgres://stub:stub@prod.invalid:5432/coffeemode?sslmode=require",
      STUB_RECOVERY_SUPER: "0",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("not a superuser");
    // Refused before step 4: nothing was created, renamed or dropped.
    expect(run.invocations).not.toContain("CREATE DATABASE");
    expect(run.invocations).not.toContain("ALTER DATABASE");
    expect(run.invocations).not.toContain("DROP DATABASE");
    expect(run.invocations).not.toContain("pg_restore -d");
  });

  it("refuses --recreate when the target database does not exist", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate", "--yes"], {
      PROD_RESTORE_URL: "postgres://stub:stub@prod.invalid:5432/coffeemode?sslmode=require",
      STUB_TARGET_MISSING: "1",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("does not exist");
    expect(run.invocations).not.toContain("CREATE DATABASE");
    expect(run.invocations).not.toContain("pg_restore -d");
  });

  it("fails a drill on a baseline archive that predates the migrations", () => {
    const run = runRestore(["--env", "staging", "--file", dumpFixture, "--drill"], {
      STUB_ARCHIVED_TABLES: "",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("--drill requires a migrated, seeded archive");
    // The refusal names the archive as a rollback baseline, not a drill sample.
    expect(run.output).toContain("empty-schema baseline");
  });

  it("accepts a baseline archive that predates the migrations", () => {
    // A pre-migration snapshot has no application relations. Verification must
    // judge the restore against that baseline instead of demanding `cafes`.
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate", "--yes"], {
      PROD_RESTORE_URL: "postgres://stub:stub@prod.invalid:5432/coffeemode?sslmode=require",
      STUB_ARCHIVED_TABLES: "",
    });

    expect(run.status).toBe(0);
    expect(run.output).toContain("Baseline archive (no application tables)");
    expect(run.output).toContain("Promotion complete");
    // A rollback to that snapshot removes the migration ledger (33 entries).
    expect(run.invocations).toContain('RENAME TO "coffeemode"');
  });

  it("rejects a restore that leaves relations outside the archive baseline", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate", "--yes"], {
      PROD_RESTORE_URL: "postgres://stub:stub@prod.invalid:5432/coffeemode?sslmode=require",
      STUB_EXTRA_RELATIONS: "stale_table",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("absent from the archive: stale_table");
    // The replacement is dropped; the live database was never renamed or dropped.
    expect(run.invocations).not.toContain('ALTER DATABASE "coffeemode" RENAME TO');
    expect(run.invocations).toContain('DROP DATABASE IF EXISTS "coffeemode__restore_');
  });

  it("carries the target's original database owner through the rollback", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate", "--yes"], {
      PROD_RESTORE_URL: "postgres://stub:stub@prod.invalid:5432/coffeemode?sslmode=require",
      STUB_COUNTS: "cafes=12 checkins=34 profiles=5",
      STUB_DB_OWNER: "someone_else",
    });

    expect(run.status).toBe(0);
    expect(run.invocations).toContain('OWNER "someone_else"');
    expect(run.output).toContain("Database owner verified: someone_else");
    expect(run.output).toContain("Promotion complete");
  });

  it("refuses to recreate a maintenance database", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--recreate", "--yes"], {
      PROD_RESTORE_URL: PROD_URL,
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("--recreate refuses target database 'postgres'");
  });

  it("rejects --recreate in drill mode", () => {
    const run = runRestore(["--env", "staging", "--file", dumpFixture, "--drill", "--recreate"]);

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("--recreate applies to live restores only");
  });
});

// BRAWUKA-753: the probe rejected *valid* archives once the decompressed stream
// passed the pipe buffer, so the success path is proven against a real
// `pg_dump -Fc | gzip` fixture in both modes, and the failure path against a
// real stream that gzip itself cannot finish.
describeIntegration("Recovery drill — real custom archive (BRAWUKA-753)", () => {
  let adminUrl = "";
  let sourceDb = "";
  let archive = "";
  let archiveGz = "";
  let rawBytes = 0;
  // Independently derived from the fixture database itself — never from the
  // restore script's own table-of-contents parse (BRAWUKA-1015 review).
  let expectedRelations: string[] = [];
  const seeded = { cafes: 0, checkins: 0, profiles: 0 };

  beforeAll(async () => {
    if (!hasPostgresClientTools) {
      return;
    }
    adminUrl = integrationAdminUrl();
    sourceDb = makeTestDbName("restore_drill_src");
    const sourceUrl = testDatabaseUrl(adminUrl, sourceDb);
    await provisionTestDatabase(adminUrl, sourceDb, { useTemplate: true });
    Object.assign(seeded, await seedDumpSource(sourceUrl));
    expectedRelations = await publicRelationNames(sourceUrl);
    archive = path.join(tmpRoot, "real-snapshot.dump");
    archiveGz = `${archive}.gz`;
    // BRAWUKA-1015: dump through the same client-mode decision backup.sh uses.
    // A host client newer than the server writes a header the 16 server rejects
    // (and an archive its own 16 client cannot read), so the fixture must be
    // produced by the server-matched client — exactly what the documented
    // backup path does. `pg_dump` directly here would make the drill fail for
    // a version skew the restore script cannot repair.
    const dumpWithServerMatchedClient = [
      "set -euo pipefail",
      `source "${path.join(REPO_ROOT, "scripts/devops/lib/pg-client.sh")}"`,
      'pg_client_plan "$1" pg_dump',
      'pg_run pg_dump "$1" -Fc',
    ].join("\n");
    const dumpFd = fs.openSync(archive, "w");
    try {
      execFileSync("bash", ["-c", dumpWithServerMatchedClient, "--", sourceUrl], {
        stdio: ["ignore", dumpFd, "inherit"],
      });
    } finally {
      fs.closeSync(dumpFd);
    }
    rawBytes = fs.statSync(archive).size;
    execSync(`gzip -9 -c "${archive}" > "${archiveGz}"`);
  });

  afterAll(async () => {
    if (!sourceDb) {
      return;
    }
    fs.rmSync(archive, { force: true });
    fs.rmSync(archiveGz, { force: true });
    await cleanupIntegrationDatabase(adminUrl, sourceDb);
  });

  it.skipIf(!hasPostgresClientTools)(
    "drills a real gzip-compressed custom archive larger than the pipe buffer",
    async () => {
      expect(rawBytes).toBeGreaterThan(PIPE_BUFFER_BYTES);
      const run = runRestore(
        ["--env", "staging", "--file", archiveGz, "--drill"],
        { STAGING_DIRECT_URL: adminUrl },
        { stubs: false },
      );

      expect(run.status).toBe(0);
      expect(run.output).toContain(
        `Archive verified: ${expectedRelations.length} application relation(s) in its table of contents.`,
      );
      expect(run.output).toContain("PASSED");
      expect(run.output).toContain(`Row count: cafes=${seeded.cafes}`);
      expect(run.output).toContain(`Row count: checkins=${seeded.checkins}`);
      expect(run.output).toContain(`Row count: profiles=${seeded.profiles}`);
      expect(run.output).toContain("Scratch drill database removed.");

      const scratchDb = run.output.match(/staging scratch database (\S+)/)?.[1] ?? "";
      expect(scratchDb).toMatch(/^restore_drill_/);
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        const { rows } = await admin.query(
          "select count(*)::int as remaining from pg_database where datname = $1",
          [scratchDb],
        );
        expect(rows[0].remaining).toBe(0);
      } finally {
        await admin.end();
      }
    },
  );

  it.skipIf(!hasPostgresClientTools)(
    "restores that archive in live mode",
    async () => {
      const targetDb = makeTestDbName("restore_live");
      const targetUrl = testDatabaseUrl(adminUrl, targetDb);
      await provisionTestDatabase(adminUrl, targetDb, { useTemplate: true });
      try {
        // Live restores run as the authorized recovery role (ADR-0010 §3);
        // the integration fixture's role owns the server, so it can recreate
        // the PostGIS extension the archive's --clean section drops.
        const run = runRestore(
          ["--env", "staging", "--file", archiveGz, "--yes"],
          { STAGING_RESTORE_URL: targetUrl },
          { stubs: false },
        );

        expect(run.status).toBe(0);
        expect(run.output).toContain("LIVE RESTORATION");
        expect(run.output).toContain(
          `Archive verified: ${expectedRelations.length} application relation(s) in its table of contents.`,
        );
        expect(run.output).toContain("Database Restoration Completed Successfully!");

        // The drill's own report is not the evidence: read the target back.
        const client = new pg.Client({ connectionString: targetUrl });
        await client.connect();
        try {
          const { rows } = await client.query<{
            cafes: number;
            checkins: number;
            profiles: number;
          }>(
            "select (select count(*) from cafes)::int as cafes, (select count(*) from checkins)::int as checkins, (select count(*) from profiles)::int as profiles",
          );
          expect(rows[0]).toEqual(seeded);
        } finally {
          await client.end();
        }
      } finally {
        await cleanupIntegrationDatabase(adminUrl, targetDb);
      }
    },
  );

  it.skipIf(!hasPostgresClientTools)(
    "keeps the original database live when promotion is interrupted before commit",
    async () => {
      const targetDb = makeTestDbName("restore_promote");
      const targetUrl = testDatabaseUrl(adminUrl, targetDb);
      await provisionTestDatabase(adminUrl, targetDb, { useTemplate: true });

      const ownerOf = async (sql: string) => {
        const client = new pg.Client({ connectionString: adminUrl });
        await client.connect();
        try {
          const { rows } = await client.query<{ owner: string }>(sql);
          return rows[0].owner;
        } finally {
          await client.end();
        }
      };
      const before = new pg.Client({ connectionString: targetUrl });
      await before.connect();
      let ledgerBefore = 0;
      try {
        await before.query("create table pre_promotion_marker (id int)");
        await before.query("insert into pre_promotion_marker values (42)");
        ledgerBefore = (
          await before.query<{ c: number }>("select count(*)::int as c from schema_migrations")
        ).rows[0].c;
      } finally {
        await before.end();
      }
      const dbOwnerBefore = await ownerOf(
        `select pg_get_userbyid(datdba) as owner from pg_database where datname = '${targetDb}'`,
      );
      const schemaOwnerBefore = await ownerOf(
        "select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'public'",
      );

      // Hold the promotion transaction open, then kill the whole process group:
      // the client dies before COMMIT, so the server must abort both renames.
      const child = spawn(
        "bash",
        [RESTORE, "--env", "prod", "--file", archiveGz, "--recreate", "--yes", "--url", targetUrl],
        {
          env: { ...process.env, RESTORE_SWAP_TEST_PAUSE_SECONDS: "15" },
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
      const deadline = Date.now() + 60_000;
      while (!output.includes("Step 7:") && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(output, "the promotion step never started").toContain("Step 7:");
      await new Promise((resolve) => setTimeout(resolve, 1500));
      process.kill(-(child.pid as number), "SIGTERM");
      const code = await exited;
      expect(code).not.toBe(0);

      // Original endpoint still serves the original data, ledger and owners.
      const after = new pg.Client({ connectionString: targetUrl });
      await after.connect();
      try {
        const marker = await after.query<{ c: number }>("select count(*)::int as c from pre_promotion_marker");
        expect(marker.rows[0].c).toBe(1);
        const ledgerAfter = await after.query<{ c: number }>("select count(*)::int as c from schema_migrations");
        expect(ledgerAfter.rows[0].c).toBe(ledgerBefore);
      } finally {
        await after.end();
      }
      expect(
        await ownerOf(`select pg_get_userbyid(datdba) as owner from pg_database where datname = '${targetDb}'`),
      ).toBe(dbOwnerBefore);
      expect(
        await ownerOf(`select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'public'`),
      ).toBe(schemaOwnerBefore);
      // No retired name survived; the replacement is inert and removed here.
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        const leftovers = await admin.query<{ datname: string }>(
          `select datname from pg_database where datname like '${targetDb}__%'`,
        );
        expect(leftovers.rows.map((row) => row.datname)).toEqual([]);
      } finally {
        await admin.end();
      }
      await cleanupIntegrationDatabase(adminUrl, targetDb);
    },
  );

  it.skipIf(!hasPostgresClientTools)(
    "fails a drill on a real pre-migration baseline archive",
    async () => {
      const baselineDb = makeTestDbName("restore_baseline");
      const baselineUrl = testDatabaseUrl(adminUrl, baselineDb);
      // A pre-migration database: no migrations, no application schema.
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      try {
        await admin.query(`drop database if exists ${quotedIdentifier(baselineDb)} with (force)`);
        await admin.query(`create database ${quotedIdentifier(baselineDb)}`);
      } finally {
        await admin.end();
      }
      const baselineArchive = path.join(tmpRoot, "baseline.dump");
      try {
        const client = new pg.Client({ connectionString: baselineUrl });
        await client.connect();
        try {
          // Provisioning creates PostGIS before the first snapshot.
          await client.query("create extension if not exists postgis");
        } finally {
          await client.end();
        }
        const dump = [
          "set -euo pipefail",
          `source "${path.join(REPO_ROOT, "scripts/devops/lib/pg-client.sh")}"`,
          'pg_client_plan "$1" pg_dump',
          'pg_run pg_dump "$1" -Fc',
        ].join("\n");
        const fd = fs.openSync(baselineArchive, "w");
        try {
          execFileSync("bash", ["-c", dump, "--", baselineUrl], { stdio: ["ignore", fd, "inherit"] });
        } finally {
          fs.closeSync(fd);
        }

        const run = runRestore(
          ["--env", "staging", "--file", baselineArchive, "--drill"],
          { STAGING_DIRECT_URL: adminUrl },
          { stubs: false },
        );
        expect(run.status).not.toBe(0);
        expect(run.output).toContain("--drill requires a migrated, seeded archive");
        expect(run.output).not.toContain("PASSED");
      } finally {
        fs.rmSync(baselineArchive, { force: true });
        await cleanupIntegrationDatabase(adminUrl, baselineDb);
      }
    },
  );

  it.skipIf(!hasPostgresClientTools)(
    "rejects a truncated copy of that archive before creating a scratch database",
    async () => {
      // A real gzip stream cut short: gzip exits nonzero, which must survive the
      // drain and fail the probe rather than being swallowed (BRAWUKA-753).
      const corrupt = path.join(tmpRoot, "corrupt.dump.gz");
      const bytes = fs.readFileSync(archiveGz);
      fs.writeFileSync(corrupt, bytes.subarray(0, bytes.length - 64));

      const run = runRestore(
        ["--env", "staging", "--file", corrupt, "--drill"],
        { STAGING_DIRECT_URL: adminUrl },
        { stubs: false },
      );

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("not a readable pg_restore archive");
      expect(run.output).not.toContain("PASSED");
      expect(run.output).not.toContain("Scratch drill database created");
    },
  );
});

/** Application relation names in `public`, excluding extension-owned members. */
async function publicRelationNames(url: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r','p','v','m','S','f')
          and not exists (
            select 1 from pg_depend d
             where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
          )
        order by c.relname`,
    );
    return rows.map((row) => row.relname);
  } finally {
    await client.end();
  }
}

/** Seed the dump source with the required tables and a payload past the pipe buffer. */
async function seedDumpSource(
  sourceUrl: string,
): Promise<{ cafes: number; checkins: number; profiles: number }> {
  const client = new pg.Client({ connectionString: sourceUrl });
  await client.connect();
  try {
    // Migrations already insert the service-account profile row; the shared
    // fixture helper owns the same three ids, so clear it before seeding.
    await client.query("delete from profiles where id = $1", [SERVICE_ACCOUNT_ID]);
    await seedBaseData(client);
    await client.query(
      "create table drill_payload as select g, md5(g::text) as payload from generate_series(1, 20000) g",
    );
    const { rows } = await client.query<{ cafes: number; checkins: number; profiles: number }>(
      "select (select count(*) from cafes)::int as cafes, (select count(*) from checkins)::int as checkins, (select count(*) from profiles)::int as profiles",
    );
    return rows[0];
  } finally {
    await client.end();
  }
}
