import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// BRAWUKA-745: the executable imports these; the suite imports them from their
// own modules, so a pure helper never has to be reached through a CLI module.
import { parseCliArgs } from "../../../scripts/devops/lib/setup-supabase-config.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SETUP_SCRIPT = path.join(REPO_ROOT, "scripts/devops/setup-supabase.mjs");
const PROVISION_SHELL_SCRIPT = path.join(REPO_ROOT, "scripts/devops/provision-supabase.sh");

describe("Supabase DevOps Provisioning — Unit Contracts", () => {
  it("scripts exist and are accessible", () => {
    expect(existsSync(SETUP_SCRIPT)).toBe(true);
    expect(existsSync(PROVISION_SHELL_SCRIPT)).toBe(true);
  });

  it("setup-supabase.mjs is Auth-only: help names Auth, not a database URL", () => {
    const output = execSync(`node "${SETUP_SCRIPT}" --help`, { encoding: "utf8" });
    expect(output).toContain("CafeMood Supabase Auth Verification Suite");
    expect(output).toContain("--supabase-url");
    expect(output).toContain("--service-role-key");
    expect(output).toContain("--verify-only");
    expect(output).toContain("--dry-run");
    // ADR-0010: application data lives in Dokploy Postgres; the suite must not
    // accept a database handle that would migrate or enforce RLS on it.
    expect(output).not.toContain("--database-url");
  });

  it("provision-supabase.sh outputs help text cleanly", () => {
    const output = execSync(`bash "${PROVISION_SHELL_SCRIPT}" --help`, { encoding: "utf8" });
    expect(output).toContain("CafeMood Supabase Auth Verification Orchestrator");
    expect(output).toContain("--supabase-url");
    expect(output).not.toContain("--database-url");
  });

  it("fails fast with exit code 1 when an invalid option is passed", () => {
    expect(() => {
      execSync(`node "${SETUP_SCRIPT}" --invalid-flag`, {
        encoding: "utf8",
        stdio: "pipe",
      });
    }).toThrow();
    // The removed database phase must fail loudly, not silently ignore the flag.
    expect(() => {
      execSync(`node "${SETUP_SCRIPT}" --database-url postgres://x/y`, {
        encoding: "utf8",
        stdio: "pipe",
      });
    }).toThrow();
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
        "SUPABASE_URL=https://root.supabase.co\n",
      );
      writeFileSync(path.join(fixtureWeb, ".env.local"), "SUPABASE_URL=https://web-env-local.supabase.co\n");
      writeFileSync(
        path.join(fixtureWeb, ".env"),
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-from-web-dotenv\n",
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
      expect(config.supabaseUrl).toBe("https://web-env-local.supabase.co");
      expect(config.anonKey).toBe("anon-from-web-dotenv");
    });

    it("prefers a CLI flag over the environment, and the environment over env files", () => {
      const fromEnv = resolvedConfig([], {
        repoRoot: fixtureRoot,
        webDir: fixtureWeb,
        env: { SUPABASE_URL: "https://from-env.supabase.co" },
      });
      expect(fromEnv.supabaseUrl).toBe("https://from-env.supabase.co");

      const fromFlag = resolvedConfig(["--supabase-url", "  https://from-flag.supabase.co  "], {
        repoRoot: fixtureRoot,
        webDir: fixtureWeb,
        env: { SUPABASE_URL: "https://from-env.supabase.co" },
      });
      expect(fromFlag.supabaseUrl).toBe("https://from-flag.supabase.co");
    });

    it("falls back through the documented env aliases in order", () => {
      const resolve = (env: Record<string, string | undefined>) =>
        resolvedConfig([], { repoRoot: emptyRoot, webDir: emptyWeb, env });
      expect(resolve({ SUPABASE_URL: "https://first.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://alias.supabase.co" }).supabaseUrl).toBe(
        "https://first.supabase.co",
      );
      expect(resolve({ NEXT_PUBLIC_SUPABASE_URL: "https://public.supabase.co" }).supabaseUrl).toBe(
        "https://public.supabase.co",
      );
      // BRAWUKA-950: new API-key names first, legacy names as the fallback.
      expect(resolve({ SUPABASE_SECRET_KEY: "secret-new" }).serviceRoleKey).toBe("secret-new");
      expect(resolve({ SUPABASE_PUBLISHABLE_KEY: "publishable-new" }).anonKey).toBe(
        "publishable-new",
      );
      expect(resolve({ SUPABASE_SERVICE_ROLE_KEY: "service-role" }).serviceRoleKey).toBe(
        "service-role",
      );
      expect(resolve({ SUPABASE_ANON_KEY: "anon-alias" }).anonKey).toBe("anon-alias");
    });

    it("--env-file replaces the default candidate files", () => {
      const customEnv = path.join(fixtureRoot, "custom.env");
      writeFileSync(customEnv, "SUPABASE_URL=https://custom-file.supabase.co\n");
      const config = resolvedConfig(["--env-file", customEnv], {
        repoRoot: fixtureRoot,
        webDir: fixtureWeb,
        env: {},
      });
      expect(config.supabaseUrl).toBe("https://custom-file.supabase.co");
      // web/.env is not consulted once --env-file names the file to load.
      expect(config.anonKey).toBe("");
    });

    it("falls back to the environment when a flag has no value", () => {
      const config = resolvedConfig(["--supabase-url"], {
        repoRoot: emptyRoot,
        webDir: emptyWeb,
        env: { SUPABASE_URL: "https://from-env.supabase.co" },
      });
      expect(config.supabaseUrl).toBe("https://from-env.supabase.co");
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
