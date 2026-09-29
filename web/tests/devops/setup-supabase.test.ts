import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// BRAWUKA-745: the executable imports these; the suite imports them from their
// own modules, so a pure helper never has to be reached through a CLI module.
import { parseCliArgs } from "../../../scripts/devops/lib/setup-supabase-config.mjs";
import { listMigrationTables, parseConnectionConfig } from "../../../scripts/devops/lib/setup-supabase-db.mjs";
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
    // BRAWUKA-378: 0026 is the first DROP TABLE — the scan mirrors the
    // subtraction in listMigrationTables, and pins rate_limits absent.
    const createTableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/gi;
    const dropTableRe = /drop\s+table\s+(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi;
    const scanned = new Set(["schema_migrations"]);
    const dropped = new Set<string>();
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      createTableRe.lastIndex = 0;
      let m;
      while ((m = createTableRe.exec(sql)) !== null) {
        if (m[1] && m[1].toLowerCase() !== "public") continue;
        scanned.add(m[2].toLowerCase());
      }
      dropTableRe.lastIndex = 0;
      while ((m = dropTableRe.exec(sql)) !== null) {
        if (m[1] && m[1].toLowerCase() !== "public") continue;
        dropped.add(m[2].toLowerCase());
      }
    }
    for (const table of dropped) scanned.delete(table);
    expect(new Set(listMigrationTables())).toEqual(scanned);
    expect(listMigrationTables()).not.toContain("rate_limits");
  });

  // The provisioning wrapper owns exactly one policy over the shared
  // translator: a Supabase host with no explicit `sslmode` gets strict TLS.
  // The full mode → ssl vocabulary is table-driven in
  // `postgres-connection.test.ts` and is not restated here.
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
    });

    it("rejects unrecognized sslmode values", () => {
      expect(() =>
        parseConnectionConfig("postgresql://user:pass@localhost:5432/db?sslmode=invalid"),
      ).toThrow(/Unrecognized sslmode "invalid"/);
    });
  });

  // BRAWUKA-745: config resolution moved into lib/setup-supabase-config.mjs.
  // The executable's observable CLI contract (help, unknown flag, exit codes)
  // stays covered above; these pin the resolution rules the CLI inherits —
  // flag > environment > env file, and the candidate-file order — without
  // spawning a process, which is the point of the extraction.
  describe("parseCliArgs — flag/env/env-file precedence", () => {
    let emptyRoot: string;
    let emptyWeb: string;
    let fixtureRoot: string;
    let fixtureWeb: string;

    beforeAll(() => {
      emptyRoot = mkdtempSync(path.join(tmpdir(), "supa-config-empty-"));
      emptyWeb = path.join(emptyRoot, "web");
      fixtureRoot = mkdtempSync(path.join(tmpdir(), "supa-config-files-"));
      fixtureWeb = path.join(fixtureRoot, "web");
      mkdirSync(fixtureWeb, { recursive: true });
      writeFileSync(
        path.join(fixtureRoot, ".env"),
        "DATABASE_URL=postgres://root-dotenv\nSUPABASE_URL=https://root.supabase.co\n",
      );
      writeFileSync(path.join(fixtureWeb, ".env.local"), "DATABASE_URL=postgres://web-env-local\n");
      writeFileSync(
        path.join(fixtureWeb, ".env"),
        "DATABASE_URL=postgres://web-dotenv\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon-from-web-dotenv\n",
      );
    });

    afterAll(() => {
      rmSync(emptyRoot, { recursive: true, force: true });
      rmSync(fixtureRoot, { recursive: true, force: true });
    });

    /** Narrow the parser result to its config arm; a non-config result fails the test. */
    function resolvedConfig(
      argv: string[],
      options: { repoRoot: string; webDir: string; env?: Record<string, string | undefined> },
    ) {
      const result = parseCliArgs(argv, options);
      expect(result.kind).toBe("config");
      if (result.kind !== "config") throw new Error("expected a resolved config");
      return result.config;
    }

    it("defaults to a non-mutating run with no credentials when nothing is set", () => {
      expect(parseCliArgs([], { repoRoot: emptyRoot, webDir: emptyWeb, env: {} })).toEqual({
        kind: "config",
        config: {
          databaseUrl: "",
          supabaseUrl: "",
          serviceRoleKey: "",
          anonKey: "",
          dryRun: false,
          verifyOnly: false,
          skipAuth: false,
          verbose: false,
        },
      });
    });

    it("maps --dry-run / --verify-only / --skip-auth / --verbose onto the config", () => {
      const config = resolvedConfig(["--dry-run", "--verify-only", "--skip-auth", "--verbose"], {
        repoRoot: emptyRoot,
        webDir: emptyWeb,
        env: {},
      });
      expect(config).toMatchObject({
        dryRun: true,
        verifyOnly: true,
        skipAuth: true,
        verbose: true,
      });
    });

    it("loads repo .env → web/.env.local → web/.env, the later file winning per key", () => {
      const config = resolvedConfig([], { repoRoot: fixtureRoot, webDir: fixtureWeb, env: {} });
      expect(config.databaseUrl).toBe("postgres://web-dotenv");
      expect(config.supabaseUrl).toBe("https://root.supabase.co");
      expect(config.anonKey).toBe("anon-from-web-dotenv");
    });

    it("prefers a CLI flag over the environment, and the environment over env files", () => {
      const fromEnv = resolvedConfig([], {
        repoRoot: fixtureRoot,
        webDir: fixtureWeb,
        env: { DATABASE_URL: "postgres://from-env" },
      });
      expect(fromEnv.databaseUrl).toBe("postgres://from-env");

      const fromFlag = resolvedConfig(["--database-url", "  postgres://from-flag  "], {
        repoRoot: fixtureRoot,
        webDir: fixtureWeb,
        env: { DATABASE_URL: "postgres://from-env" },
      });
      expect(fromFlag.databaseUrl).toBe("postgres://from-flag");
    });

    it("falls back through the documented env aliases in order", () => {
      const resolve = (env: Record<string, string | undefined>) =>
        resolvedConfig([], { repoRoot: emptyRoot, webDir: emptyWeb, env });
      expect(resolve({ DATABASE_URL: "postgres://first", POSTGRES_URL: "postgres://alias" }).databaseUrl).toBe(
        "postgres://first",
      );
      expect(resolve({ POSTGRES_URL: "postgres://pg-alias" }).databaseUrl).toBe("postgres://pg-alias");
      expect(resolve({ SUPABASE_DATABASE_URL: "postgres://sb-alias" }).databaseUrl).toBe(
        "postgres://sb-alias",
      );
      expect(resolve({ NEXT_PUBLIC_SUPABASE_URL: "https://public.supabase.co" }).supabaseUrl).toBe(
        "https://public.supabase.co",
      );
      expect(resolve({ SUPABASE_SERVICE_ROLE_KEY: "service-role" }).serviceRoleKey).toBe("service-role");
      expect(resolve({ SUPABASE_ANON_KEY: "anon-alias" }).anonKey).toBe("anon-alias");
    });

    it("--env-file replaces the default candidate files", () => {
      const customEnv = path.join(fixtureRoot, "custom.env");
      writeFileSync(customEnv, "DATABASE_URL=postgres://custom-file\n");
      const config = resolvedConfig(["--env-file", customEnv], {
        repoRoot: fixtureRoot,
        webDir: fixtureWeb,
        env: {},
      });
      expect(config.databaseUrl).toBe("postgres://custom-file");
      // web/.env is not consulted once --env-file names the file to load.
      expect(config.anonKey).toBe("");
    });

    it("falls back to the environment when a flag has no value", () => {
      const config = resolvedConfig(["--database-url"], {
        repoRoot: emptyRoot,
        webDir: emptyWeb,
        env: { DATABASE_URL: "postgres://from-env" },
      });
      expect(config.databaseUrl).toBe("postgres://from-env");
    });

    it("reports help and unknown options instead of exiting — the caller owns the exit code", () => {
      const options = { repoRoot: emptyRoot, webDir: emptyWeb, env: {} };
      expect(parseCliArgs(["--help"], options)).toEqual({ kind: "help" });
      expect(parseCliArgs(["-h"], options)).toEqual({ kind: "help" });
      expect(parseCliArgs(["--help", "--invalid-flag"], options)).toEqual({ kind: "help" });
      expect(parseCliArgs(["--invalid-flag", "--help"], options)).toEqual({
        kind: "unknown-option",
        arg: "--invalid-flag",
      });
      expect(parseCliArgs(["--invalid-flag"], options)).toEqual({
        kind: "unknown-option",
        arg: "--invalid-flag",
      });
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
    // BRAWUKA-745: the failing run must also still close its client — the DB
    // operation owns cleanup in a `finally`, so an error never leaks a
    // connection (the observable half: the close line is printed before exit).
    let failure: { stdout: string; stderr: string } | null = null;
    try {
      execSync(
        `node "${SETUP_SCRIPT}" --dry-run --skip-auth --database-url "${testDbUrl}"`,
        { encoding: "utf8", stdio: "pipe" },
      );
    } catch (err) {
      const failed = err as { stdout?: string; stderr?: string };
      failure = { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
    }
    expect(failure).not.toBeNull();
    expect(failure?.stderr).toMatch(/RLS coverage incomplete/);
    expect(failure?.stdout).toContain("Closed database connection.");
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
