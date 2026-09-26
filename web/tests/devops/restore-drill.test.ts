import { execSync } from "node:child_process";
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

// `--list` is the archive-readability probe; every other call is a restore.
// The probe returns without reading stdin, which is exactly what the real
// `pg_restore --list` does — and what made gzip die of SIGPIPE (BRAWUKA-753).
// The restore path drains its stdin first, like a real restore does.
// STUB_RESTORE_OK=0 reproduces "pg_restore exited nonzero".
const PG_RESTORE_STUB = `#!/usr/bin/env bash
set -u
printf 'pg_restore %s\\n' "$*" >> "$STUB_LOG"
case "$*" in
  *"--list"*)
    if [ "\${STUB_ARCHIVE_READABLE:-1}" != "1" ]; then
      printf 'pg_restore: error: could not read from input file\\n' >&2
      exit 1
    fi
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
// STUB_POSTGIS / STUB_SPATIAL   "missing" fails the PostGIS / spatial check
const PSQL_STUB = `#!/usr/bin/env bash
set -u
printf 'psql %s\\n' "$*" >> "$STUB_LOG"
sql="$*"
for table in \${STUB_FAIL_TABLES:-}; do
  case "$sql" in
    *"FROM $table;"*) printf 'ERROR:  relation "%s" does not exist\\n' "$table" >&2; exit 3 ;;
  esac
done
for table in \${STUB_JUNK_TABLES:-}; do
  case "$sql" in
    *"FROM $table;"*) printf 'NaN\\n'; exit 0 ;;
  esac
done
case "$sql" in
  *"DROP DATABASE IF EXISTS"*|*"CREATE DATABASE"*) exit 0 ;;
  *"PostGIS_Version"*)
    if [ "\${STUB_POSTGIS:-ok}" != "ok" ]; then
      printf 'ERROR:  function postgis_version() does not exist\\n' >&2
      exit 3
    fi
    printf '3.4 USE_GEOS=1\\n'
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

  it("fails when a required table is missing after an otherwise clean restore", () => {
    const run = runDrill({ STUB_FAIL_TABLES: "checkins profiles", STUB_COUNTS: "cafes=3" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("checkins");
    expect(run.output).toContain("missing or unreadable");
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
    expect(run.output).toContain("Restored content verified: 5 row(s)");
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
    expect(run.output).toContain("Archive verified: pg_restore read its table of contents.");
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

  it("fails when a row count is not a number", () => {
    const run = runDrill({ STUB_JUNK_TABLES: "cafes" });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.output).toContain("not a number");
  });

  it("passes a valid fixture restore and drops the scratch database", () => {
    const run = runDrill({ STUB_COUNTS: "cafes=12 checkins=34 profiles=5" });

    expect(run.status).toBe(0);
    expect(run.output).toContain("PASSED");
    expect(run.output).toContain("cafes=12");
    const scratchDb = scratchDbFrom(run.invocations);
    expect(run.invocations).toContain(`CREATE DATABASE "${scratchDb}"`);
    expect(run.output).toContain("Scratch drill database removed");
    expect(run.invocations).toContain(`DROP DATABASE IF EXISTS "${scratchDb}"`);
  });

  it("applies the same strict verification to a live restore", () => {
    const run = runRestore(["--env", "prod", "--file", dumpFixture, "--yes"], {
      PROD_DIRECT_URL: PROD_URL,
      STUB_FAIL_TABLES: "profiles",
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("profiles");
    expect(run.output).toContain("missing or unreadable");
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
    archive = path.join(tmpRoot, "real-snapshot.dump");
    archiveGz = `${archive}.gz`;
    fs.writeFileSync(
      archive,
      execSync(`pg_dump -Fc "${sourceUrl}"`, { maxBuffer: 256 * 1024 * 1024 }),
    );
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
      expect(run.output).toContain("Archive verified: pg_restore read its table of contents.");
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
        const run = runRestore(
          ["--env", "staging", "--file", archiveGz, "--yes"],
          { STAGING_DIRECT_URL: targetUrl },
          { stubs: false },
        );

        expect(run.status).toBe(0);
        expect(run.output).toContain("LIVE RESTORATION");
        expect(run.output).toContain("Archive verified: pg_restore read its table of contents.");
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
