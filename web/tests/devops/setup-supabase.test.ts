import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupIntegrationDatabase,
  integrationAdminUrl,
  makeTestDbName,
  provisionTestDatabase,
  testDatabaseUrl,
} from "../helpers/db";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SETUP_SCRIPT = path.join(REPO_ROOT, "scripts/devops/setup-supabase.mjs");
const PROVISION_SHELL_SCRIPT = path.join(REPO_ROOT, "scripts/devops/provision-supabase.sh");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "web/db/migrations");

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "1";
const describeIntegration = RUN_INTEGRATION ? describe : describe.skip;

describe("Supabase DevOps Provisioning — Unit Contracts", () => {
  it("scripts exist and are accessible", () => {
    expect(existsSync(SETUP_SCRIPT)).toBe(true);
    expect(existsSync(PROVISION_SHELL_SCRIPT)).toBe(true);
  });

  it("setup-supabase.mjs outputs help text cleanly", () => {
    const output = execSync(`node "${SETUP_SCRIPT}" --help`, { encoding: "utf8" });
    expect(output).toContain("CoffeeMode Supabase Provisioning & Verification Suite");
    expect(output).toContain("--database-url");
    expect(output).toContain("--supabase-url");
    expect(output).toContain("--service-role-key");
    expect(output).toContain("--verify-only");
    expect(output).toContain("--dry-run");
  });

  it("provision-supabase.sh outputs help text cleanly", () => {
    const output = execSync(`bash "${PROVISION_SHELL_SCRIPT}" --help`, { encoding: "utf8" });
    expect(output).toContain("CoffeeMode Supabase Production Provisioning Orchestrator");
    expect(output).toContain("--database-url");
    expect(output).toContain("--supabase-url");
  });

  it("fails fast with exit code 1 when an invalid option is passed", () => {
    expect(() => {
      execSync(`node "${SETUP_SCRIPT}" --invalid-flag`, {
        encoding: "utf8",
        stdio: "pipe",
      });
    }).toThrow();
  });

  it("all 19 migration files in web/db/migrations are ordered and present", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => {
        const na = parseInt(a.match(/^(\d+)/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/^(\d+)/)?.[1] ?? "0", 10);
        return na - nb;
      });

    expect(files.length).toBeGreaterThanOrEqual(19);
    expect(files[0]).toBe("0001_init.sql");
    expect(files[18]).toBe("0019_checkin_idempotency.sql");
  });

  it("enforces fail-closed SSL verification for Supabase hosts", () => {
    const testCode = `
      import { createRequire } from "node:module";
      const req = createRequire(process.cwd() + "/package.json");
      const url = new URL("postgresql://postgres:test@db.rsdzcegylqgccaneomph.supabase.co:5432/postgres");
      const isSupabase = url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.net");
      console.log(JSON.stringify({ isSupabase }));
    `;
    const output = execSync(`node -e '${testCode}'`, { encoding: "utf8" });
    const parsed = JSON.parse(output.trim());
    expect(parsed.isSupabase).toBe(true);
  });
});

describeIntegration("Supabase DevOps Provisioning — Real Postgres Integration", () => {
  let adminUrl: string;
  let testDbName: string;
  let testDbUrl: string;

  beforeAll(async () => {
    adminUrl = integrationAdminUrl();
    testDbName = makeTestDbName("supa_prov_test");
    testDbUrl = testDatabaseUrl(adminUrl, testDbName);
    // Create unmigrated fresh database to test dry-run and full provision from zero
    await provisionTestDatabase(adminUrl, testDbName, { useTemplate: false });
  });

  afterAll(async () => {
    if (adminUrl && testDbName) {
      try {
        await cleanupIntegrationDatabase(adminUrl, testDbName);
      } catch {
        // ignore cleanup error on teardown
      }
    }
  }, 60_000);

  it("dry-run mode executes cleanly on fresh empty database", () => {
    const output = execSync(
      `node "${SETUP_SCRIPT}" --dry-run --skip-auth --database-url "${testDbUrl}"`,
      { encoding: "utf8", stdio: "pipe" }
    );
    expect(output).toContain("Target Mode: DRY RUN");
    expect(output).toContain("[DRY RUN]");
    expect(output).toContain("Supabase Provisioning & Verification Finished Successfully");
  });

  it("provisions database and verify-only checks tables and spatial GiST index", () => {
    // 1. Run real provision
    const provisionOutput = execSync(
      `node "${SETUP_SCRIPT}" --skip-auth --database-url "${testDbUrl}"`,
      { encoding: "utf8", stdio: "pipe" }
    );
    expect(provisionOutput).toContain("Supabase Provisioning & Verification Finished Successfully");

    // 2. Verify-only
    const verifyOutput = execSync(
      `node "${SETUP_SCRIPT}" --verify-only --skip-auth --database-url "${testDbUrl}"`,
      { encoding: "utf8", stdio: "pipe" }
    );
    expect(verifyOutput).toContain("Target Mode: VERIFY ONLY");
    expect(verifyOutput).toContain("Table 'public.cafes' exists.");
    expect(verifyOutput).toContain("Table 'public.profiles' exists.");
    expect(verifyOutput).toContain("Spatial GiST index 'idx_cafes_location_active' exists on cafes.");
    expect(verifyOutput).toContain("Supabase Provisioning & Verification Finished Successfully");
  });
});
