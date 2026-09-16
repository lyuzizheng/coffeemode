import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";

// BRAWUKA-337: the drift check (repo migrations vs schema_migrations ledger)
// must stay red-green without a live Supabase project — exercised here against
// a throwaway local Postgres database. Staging/prod wiring runs the same
// script over DIRECT_URL (scripts/devops/run-staging-journey.sh Step 0,
// upgrade-prod.sh Step 3).
const DRIFT_SCRIPT = path.resolve(__dirname, "../../scripts/check-migration-drift.mjs");

function drift(url: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("node", [DRIFT_SCRIPT, "--database-url", url], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return { ok: true, out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describeIntegration("check-migration-drift red-green", () => {
  let adminUrl: string;
  let testDbName: string;
  let testDbUrl: string;

  beforeAll(async () => {
    adminUrl = integrationAdminUrl();
    testDbName = makeTestDbName("drift_check");
    testDbUrl = testDatabaseUrl(adminUrl, testDbName);
    await provisionTestDatabase(adminUrl, testDbName, { useTemplate: false });
  }, 60_000);

  afterAll(async () => {
    if (adminUrl && testDbName) {
      await cleanupIntegrationDatabase(adminUrl, testDbName).catch(() => {});
    }
  }, 60_000);

  it("green when converged, red on a missing ledger row, green after re-migrate", async () => {
    const client = new pg.Client({ connectionString: testDbUrl });
    await client.connect();
    try {
      expect(drift(testDbUrl).ok).toBe(true);
      await client.query("delete from schema_migrations where name = '0024_service_account_rename.sql'");
      const gap = drift(testDbUrl);
      expect(gap.ok).toBe(false);
      expect(gap.out).toContain("0024_service_account_rename.sql");
    } finally {
      await client.end();
    }
    execFileSync("node", ["scripts/migrate.mjs"], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: "pipe",
    });
    expect(drift(testDbUrl).ok).toBe(true);
  }, 60_000);
});
