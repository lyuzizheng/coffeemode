import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
} from "../helpers/db";
import { isTestDatabaseName } from "../../scripts/cleanup-stale-test-dbs.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const RUNNER = path.join(REPO_ROOT, "scripts/devops/run-staging-journey.sh");
const SWEEPER = path.join(REPO_ROOT, "web/scripts/cleanup-stale-test-dbs.mjs");

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

function sh(cmd: string, env: Record<string, string | undefined> = {}): string {
  const next = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return execSync(cmd, { encoding: "utf8", env: next });
}

function shFails(cmd: string, env: Record<string, string | undefined> = {}): void {
  expect(() => sh(cmd, env)).toThrow();
}

describe("Staging journey runner — CLI contracts", () => {
  it("prints usage with --help", () => {
    const out = sh(`bash "${RUNNER}" --help`);
    expect(out).toContain("STAGING_DATABASE_URL");
    expect(out).toContain("--suite <journey|http|db|all>");
    expect(out).toContain("--skip-setup");
    expect(out).toContain("--skip-cleanup");
    expect(out).toContain("--dry-run");
  });

  it("fails fast on an unknown flag", () => {
    shFails(`bash "${RUNNER}" --bogus`);
  });

  it("fails fast when STAGING_DATABASE_URL is unset (never guesses a target)", () => {
    shFails(`bash "${RUNNER}" --dry-run`, { STAGING_DATABASE_URL: undefined });
  });

  it("rejects an invalid suite", () => {
    shFails(`bash "${RUNNER}" --suite nope --dry-run`, {
      STAGING_DATABASE_URL: "postgres://staging.invalid:5432/staging",
    });
  });

  it("dry-run prints setup/run/cleanup plan without executing", () => {
    const out = sh(`bash "${RUNNER}" --suite journey --dry-run`, {
      STAGING_DATABASE_URL: "postgres://staging.invalid:5432/staging",
    });
    expect(out).toContain("setup-supabase.mjs");
    expect(out).toContain("npm run test:integration:journey");
    expect(out).toContain("cleanup-stale-test-dbs.mjs --apply");
  });
});

describe("Stale test-DB sweeper — CLI contracts", () => {
  it("prints usage with --help", () => {
    const out = sh(`node "${SWEEPER}" --help`);
    expect(out).toContain("--apply");
    expect(out).toContain("--only");
    expect(out).toContain("ALLOW_REMOTE_INTEGRATION_DB=1");
  });

  it("fails fast when --only has no value", () => {
    shFails(`node "${SWEEPER}" --only`);
  });

  it("fails fast on an unknown flag", () => {
    shFails(`node "${SWEEPER}" --bogus`);
  });

  it("refuses a non-local host without the remote opt-in (no connection attempted)", () => {
    shFails(
      `node "${SWEEPER}" --database-url "postgres://postgres:x@db.example.supabase.co:5432/postgres"`,
      { ALLOW_REMOTE_INTEGRATION_DB: undefined },
    );
  });

  it("matches only provisioned test-database names", () => {
    const pid = process.pid;
    const hex = randomUUID().replaceAll("-", "");
    expect(isTestDatabaseName(`coffeemode_journey_dc_${pid}_${hex}`)).toBe(true);
    expect(isTestDatabaseName(`coffeemode_http_disc_${pid}_${hex}`)).toBe(true);
    expect(isTestDatabaseName(`coffeemode_test_${pid}_${hex}`)).toBe(true);
    expect(isTestDatabaseName(`supa_prov_test_${pid}_${hex}`)).toBe(true);
    // Never match: templates, real app databases, partial names.
    expect(isTestDatabaseName("coffeemode_test_template")).toBe(false);
    expect(isTestDatabaseName("coffeemode")).toBe(false);
    expect(isTestDatabaseName("coffeemode_staging")).toBe(false);
    expect(isTestDatabaseName("postgres")).toBe(false);
    expect(isTestDatabaseName(`coffeemode_test_${pid}`)).toBe(false);
    expect(isTestDatabaseName("coffeemode_test_123_nothex")).toBe(false);
  });
});

describeIntegration("Stale test-DB sweeper — real Postgres", () => {
  let adminUrl: string;
  const orphanDb = makeTestDbName("coffeemode_test");

  beforeAll(async () => {
    adminUrl = integrationAdminUrl();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${orphanDb}"`);
    } finally {
      await admin.end();
    }
  });

  afterAll(async () => {
    // Benign: teardown cleanup of ephemeral orphan test database.
    await cleanupIntegrationDatabase(adminUrl, orphanDb).catch(() => {});
  });

  it("dry-run lists the orphan without dropping it", async () => {
    const out = sh(`node "${SWEEPER}" --database-url "${adminUrl}"`);
    expect(out).toContain(orphanDb);
    expect(out).toContain("Dry-run");
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      const res = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [orphanDb]);
      expect(res.rows.length).toBe(1);
    } finally {
      await admin.end();
    }
  });

  it("--apply --only drops only the named orphan, never a bystander test DB", async () => {
    // BRAWUKA-255: an unfiltered --apply in this parallel vitest run dropped
    // setup-supabase.test.ts's live scratch DB (supa_prov_test_* sits at zero
    // backends between its execSync subprocesses). The sweep must stay scoped
    // to the orphan this suite created; the bystander simulates a sibling
    // suite's database and must survive.
    const bystanderDb = makeTestDbName("supa_prov_test");
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${bystanderDb}"`);
      const out = sh(`node "${SWEEPER}" --database-url "${adminUrl}" --apply --only "${orphanDb}"`);
      expect(out).toContain(`Dropped ${orphanDb}`);
      expect(out).not.toContain(`Dropped ${bystanderDb}`);
      const res = await admin.query(
        "SELECT datname FROM pg_database WHERE datname = ANY($1)",
        [[orphanDb, bystanderDb]],
      );
      const surviving = res.rows.map((r) => r.datname);
      expect(surviving).toEqual([bystanderDb]);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${bystanderDb}" WITH (FORCE)`).catch(() => {});
      await admin.end();
    }
  });
});
