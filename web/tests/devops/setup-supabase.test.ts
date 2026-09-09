import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SETUP_SCRIPT = path.join(REPO_ROOT, "scripts/devops/setup-supabase.mjs");
const PROVISION_SHELL_SCRIPT = path.join(REPO_ROOT, "scripts/devops/provision-supabase.sh");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "web/db/migrations");

describe("Supabase DevOps Provisioning Scripts", () => {
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

  it("dry-run mode executes without database mutation", () => {
    const output = execSync(
      `node "${SETUP_SCRIPT}" --dry-run --skip-auth --database-url "postgres://coffeemode:coffeemode@127.0.0.1:5432/coffeemode?sslmode=disable"`,
      { encoding: "utf8", stdio: "pipe" }
    );
    expect(output).toContain("Target Mode: DRY RUN");
    expect(output).toContain("[DRY RUN]");
    expect(output).toContain("Supabase Provisioning & Verification Finished Successfully");
  });

  it("verify-only mode verifies table, GiST index, and migrations integrity", () => {
    const output = execSync(
      `node "${SETUP_SCRIPT}" --verify-only --skip-auth --database-url "postgres://coffeemode:coffeemode@127.0.0.1:5432/coffeemode?sslmode=disable"`,
      { encoding: "utf8", stdio: "pipe" }
    );
    expect(output).toContain("Target Mode: VERIFY ONLY");
    expect(output).toContain("Table 'public.cafes' exists.");
    expect(output).toContain("Table 'public.profiles' exists.");
    expect(output).toContain("Spatial GiST index 'idx_cafes_location_active' exists on cafes.");
    expect(output).toContain("Supabase Provisioning & Verification Finished Successfully");
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
});
