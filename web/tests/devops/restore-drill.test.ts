import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// BRAWUKA-728: `--drill` certified failed restorations as PASSED — a nonzero
// `pg_restore` exit status was downgraded to a warning, and a failing `psql`
// count query was substituted with `0`. The suite below runs the real
// `scripts/devops/restore.sh` against deterministic local stubs: the stub is
// what decides whether `pg_restore`/`psql` succeed, and every assertion is about
// the script's own verdict (exit status, PASSED banner, scratch-DB lifecycle).
// No infrastructure, credentials, or ambient DATABASE_URL is involved.
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RESTORE = path.join(REPO_ROOT, "scripts/devops/restore.sh");
const STAGING_URL = "postgres://stub:stub@drill.invalid:5432/postgres?sslmode=require";
const PROD_URL = "postgres://stub:stub@prod.invalid:5432/postgres?sslmode=require";

// `--list` is the archive-readability probe; the restore call is everything else.
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
if [ "\${STUB_RESTORE_OK:-1}" != "1" ]; then
  printf 'pg_restore: error: injected restore failure\\n' >&2
  exit 1
fi
exit 0
`;

// STUB_FAIL_TABLES    required tables whose count query errors (relation missing)
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
  STUB_COUNTS: undefined,
  STUB_POSTGIS: undefined,
  STUB_SPATIAL: undefined,
  STUB_SPATIAL_COUNT: undefined,
};

function runRestore(
  args: string[],
  overrides: Record<string, string | undefined> = {},
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
  env.PATH = `${stubBin}:${env.PATH ?? ""}`;

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

function runDrill(overrides: Record<string, string | undefined> = {}): DrillRun {
  return runRestore(["--env", "staging", "--file", dumpFixture, "--drill"], overrides);
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

  it.each([
    ["the PostGIS extension check", { STUB_POSTGIS: "missing" }],
    ["the spatial contract query", { STUB_SPATIAL: "missing" }],
  ] as const)("fails when %s fails", (_label, overrides) => {
    const run = runDrill({ ...overrides });

    expect(run.status).not.toBe(0);
    expect(run.output).not.toContain("PASSED");
    expect(run.invocations).toContain("DROP DATABASE IF EXISTS");
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
