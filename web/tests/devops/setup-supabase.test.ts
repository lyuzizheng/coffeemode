import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listMigrationTables, parseConnectionConfig } from "../../../scripts/devops/setup-supabase.mjs";
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
    expect(output).toContain("CafeMood Supabase Provisioning & Verification Suite");
    expect(output).toContain("--database-url");
    expect(output).toContain("--supabase-url");
    expect(output).toContain("--service-role-key");
    expect(output).toContain("--verify-only");
    expect(output).toContain("--dry-run");
  });

  it("provision-supabase.sh outputs help text cleanly", () => {
    const output = execSync(`bash "${PROVISION_SHELL_SCRIPT}" --help`, { encoding: "utf8" });
    expect(output).toContain("CafeMood Supabase Production Provisioning Orchestrator");
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

  it("provision table inventory derives from web/db/migrations (no hand-kept list)", () => {
    // BRAWUKA-337: 0021 helpful_ranking_* shipped RLS-dark because the
    // provision inventory was hand-maintained. The inventory must equal an
    // independent CREATE TABLE scan of the migrations dir, so the next new
    // table is covered with zero test edits.
    const createTableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
    const scanned = new Set(["schema_migrations"]);
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      createTableRe.lastIndex = 0;
      let m;
      while ((m = createTableRe.exec(sql)) !== null) {
        if (m[1] && m[1].toLowerCase() !== "public") continue;
        scanned.add(m[2].toLowerCase());
      }
    }
    expect(new Set(listMigrationTables())).toEqual(scanned);
  });

  describe("parseConnectionConfig SSL enforcement", () => {
    it("enforces strict TLS verification by default for Supabase hosts", () => {
      const configCo = parseConnectionConfig(
        "postgresql://postgres:test@db.rsdzcegylqgccaneomph.supabase.co:5432/postgres",
      );
      expect(configCo.ssl).toEqual({ rejectUnauthorized: true });

      const configNet = parseConnectionConfig(
        "postgresql://postgres:test@db.project.supabase.net:5432/postgres",
      );
      expect(configNet.ssl).toEqual({ rejectUnauthorized: true });
    });

    it("does not force SSL for non-Supabase hosts without sslmode", () => {
      const config = parseConnectionConfig("postgresql://postgres:test@localhost:5432/postgres");
      expect(config.ssl).toBeUndefined();
    });

    it("honors explicit sslmode overrides", () => {
      expect(
        parseConnectionConfig("postgresql://user:pass@db.supabase.co:5432/db?sslmode=disable").ssl,
      ).toBe(false);
      expect(
        parseConnectionConfig(
          "postgresql://user:pass@db.supabase.co:5432/db?sslmode=allow-self-signed",
        ).ssl,
      ).toEqual({ rejectUnauthorized: false });
      expect(
        parseConnectionConfig("postgresql://user:pass@localhost:5432/db?sslmode=require").ssl,
      ).toEqual({ rejectUnauthorized: true });
      expect(
        parseConnectionConfig("postgresql://user:pass@localhost:5432/db?sslmode=verify-full").ssl,
      ).toEqual({ rejectUnauthorized: true });
      expect(
        parseConnectionConfig("postgresql://user:pass@localhost:5432/db?sslmode=prefer").ssl,
      ).toEqual({ rejectUnauthorized: true });
      expect(
        parseConnectionConfig("postgresql://user:pass@localhost:5432/db?sslmode=verify-ca").ssl,
      ).toEqual({ rejectUnauthorized: true });
    });

    it("rejects unrecognized sslmode values", () => {
      expect(() =>
        parseConnectionConfig("postgresql://user:pass@localhost:5432/db?sslmode=invalid"),
      ).toThrow(/Unrecognized sslmode "invalid"/);
    });
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

  it("dry-run on a fresh database fails closed on RLS-dark tables (drift signal)", () => {
    // BRAWUKA-337: dry-run/verify-only must FAIL (exit 1) when migration
    // tables lack RLS — warn-and-pass is how 0021 helpful_ranking_* shipped
    // RLS-dark. A fresh DB has RLS off on every table, so this must throw.
    expect(() => {
      execSync(
        `node "${SETUP_SCRIPT}" --dry-run --skip-auth --database-url "${testDbUrl}"`,
        { encoding: "utf8", stdio: "pipe" },
      );
    }).toThrow(/RLS coverage incomplete/);
  });

  it("provisions database and verify-only checks tables and spatial GiST index", () => {
    // 1. Run real provision
    const provisionOutput = execSync(
      `node "${SETUP_SCRIPT}" --skip-auth --database-url "${testDbUrl}"`,
      { encoding: "utf8", stdio: "pipe" }
    );
    expect(provisionOutput).toContain("Supabase Provisioning & Verification Finished Successfully");
    expect(provisionOutput).toContain("Post-provision RLS self-verification passed");

    // 2. Verify-only
    const verifyOutput = execSync(
      `node "${SETUP_SCRIPT}" --verify-only --skip-auth --database-url "${testDbUrl}"`,
      { encoding: "utf8", stdio: "pipe" }
    );
    expect(verifyOutput).toContain("Target Mode: VERIFY ONLY");
    expect(verifyOutput).toContain("Table 'public.cafes' exists.");
    expect(verifyOutput).toContain("Table 'public.profiles' exists.");
    expect(verifyOutput).toContain("RLS enabled on 'helpful_ranking_runs'.");
    expect(verifyOutput).toContain("RLS enabled on 'helpful_ranking_entries'.");
    expect(verifyOutput).toContain("Spatial GiST index 'idx_cafes_location_active' exists on cafes.");
    expect(verifyOutput).toContain("Supabase Provisioning & Verification Finished Successfully");
  });
});
