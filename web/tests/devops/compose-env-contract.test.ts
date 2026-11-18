import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BRAWUKA-1015: `deploy/dokploy/.env.prod` is a compose `env_file` mounted into
 * the web container, so every key in it is readable by the application process.
 * The Postgres bootstrap credentials and the recovery-role URL therefore live
 * outside it: `.env.prod.db` is referenced by `db-prod` alone, and RESTORE_URL
 * is operator-shell only. This suite is the regression contract for that split.
 */
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEPLOY = path.join(REPO_ROOT, "deploy/dokploy");
const APP_ENV = path.join(DEPLOY, ".env.prod.example");
const DB_ENV = path.join(DEPLOY, ".env.prod.db.example");
const COMPOSE = path.join(DEPLOY, "docker-compose.prod.yml");

const BOOTSTRAP_KEYS = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "APP_DB_PASSWORD"];
const FORBIDDEN_IN_APP_ENV = [...BOOTSTRAP_KEYS, "RESTORE_URL", "STAGING_RESTORE_URL", "PROD_RESTORE_URL"];

/** Keys defined in an env file (ignores comments and blank lines). */
function envKeys(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
}

/** The YAML block of one service, from its two-space key to the next one. */
function serviceBlock(name: string): string {
  const text = fs.readFileSync(COMPOSE, "utf8");
  const start = text.indexOf(`\n  ${name}:\n`);
  expect(start, `service ${name} is missing from the prod compose`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function envFileEntries(block: string): string[] {
  const match = block.match(/\n {4}env_file:\n((?: {6}- .*\n)+)/);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .filter(Boolean);
}

const hasDocker = (() => {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("prod compose environment contract", () => {
  it("keeps bootstrap and recovery credentials out of the app env file", () => {
    const keys = envKeys(APP_ENV);
    for (const key of FORBIDDEN_IN_APP_ENV) {
      expect(keys, `${key} must not be in .env.prod: that file is passed to web-prod`).not.toContain(key);
    }
  });

  it("declares the bootstrap credentials in the db-only env file", () => {
    const keys = envKeys(DB_ENV);
    for (const key of BOOTSTRAP_KEYS) expect(keys).toContain(key);
    expect(keys).not.toContain("RESTORE_URL");
  });

  it("passes .env.prod.db to db-prod and never to web-prod", () => {
    expect(envFileEntries(serviceBlock("db-prod"))).toEqual([".env.prod.db"]);
    expect(envFileEntries(serviceBlock("web-prod"))).toEqual([".env.prod"]);
    // No other service may mount the bootstrap file either.
    const text = fs.readFileSync(COMPOSE, "utf8");
    const references = text.match(/^\s*- \.env\.prod\.db$/gm) ?? [];
    expect(references.length).toBe(1);
  });

  it.skipIf(!hasDocker)("renders web-prod without any bootstrap or recovery key", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coffeemode-compose-contract-"));
    try {
      fs.copyFileSync(COMPOSE, path.join(tmp, "docker-compose.prod.yml"));
      // Synthetic values: the contract is about key placement, never real secrets.
      fs.writeFileSync(
        path.join(tmp, ".env.prod"),
        "DATABASE_URL=postgres://app:stub@db.invalid:5432/coffeemode?sslmode=disable\nDIRECT_URL=postgres://app:stub@db.invalid:5432/coffeemode?sslmode=disable\n",
      );
      fs.writeFileSync(
        path.join(tmp, ".env.prod.db"),
        "POSTGRES_DB=coffeemode\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=db-bootstrap-secret-value\nAPP_DB_PASSWORD=app-db-secret-value\n",
      );
      // Interpolation values for every `${VAR:?}` the compose file declares.
      const composeText = fs.readFileSync(COMPOSE, "utf8");
      const interpolated = [...composeText.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((match) => match[1]);
      const interpolatedEnv = [
        ...[...new Set(interpolated)].map((name) => `${name}=stub`),
        // Recovery enabled in the operator shell: the value must not surface in
        // the rendered web service, and neither must any bootstrap value.
        "PROD_RESTORE_URL=postgres://operator:restore-role-secret-value@db.invalid:5432/coffeemode",
      ].join("\n");
      fs.writeFileSync(path.join(tmp, ".env"), `${interpolatedEnv}\n`);

      const rendered = execFileSync(
        "docker",
        ["compose", "-f", path.join(tmp, "docker-compose.prod.yml"), "--env-file", path.join(tmp, ".env"), "config", "--format", "json"],
        { encoding: "utf8" },
      );
      const config = JSON.parse(rendered) as {
        services: Record<string, { environment?: Record<string, string> }>;
      };
      const web = config.services["web-prod"]?.environment ?? {};
      const db = config.services["db-prod"]?.environment ?? {};
      for (const key of FORBIDDEN_IN_APP_ENV) {
        expect(Object.keys(web), `${key} reached web-prod`).not.toContain(key);
      }
      // Names are not enough: a privileged value under a harmless key would leak
      // just as well. Check the rendered values too.
      const webValues = Object.values(web).join("\n");
      for (const secret of ["db-bootstrap-secret-value", "app-db-secret-value", "restore-role-secret-value"]) {
        expect(webValues, `${secret} reached web-prod`).not.toContain(secret);
      }
      expect(db.POSTGRES_PASSWORD).toBe("db-bootstrap-secret-value");
      expect(db.APP_DB_PASSWORD).toBe("app-db-secret-value");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("keeps the real bootstrap env file out of Git and configuration archives", () => {
    // Git: the tracked example stays, the real credential file is ignored.
    expect(execFileSync("git", ["-C", REPO_ROOT, "ls-files", "deploy/dokploy/.env.prod.db.example"], { encoding: "utf8" }).trim()).not.toBe("");
    const ignored = spawnSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", "deploy/dokploy/.env.prod.db"]);
    expect(ignored.status, "deploy/dokploy/.env.prod.db must be gitignored").toBe(0);

    // Configuration archive: a synthetic credential file must not be packaged.
    const marker = `synthetic-marker-${process.pid}-${Date.now()}`;
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "coffeemode-config-archive-"));
    try {
      fs.cpSync(path.join(REPO_ROOT, "scripts/devops"), path.join(sandbox, "scripts/devops"), { recursive: true });
      fs.mkdirSync(path.join(sandbox, "deploy/dokploy"), { recursive: true });
      fs.copyFileSync(COMPOSE, path.join(sandbox, "deploy/dokploy/docker-compose.prod.yml"));
      fs.writeFileSync(path.join(sandbox, "deploy/dokploy/.env.prod.db"), `POSTGRES_PASSWORD=${marker}\n`);
      fs.writeFileSync(path.join(sandbox, "deploy/dokploy/.env.prod"), `DATABASE_URL=postgres://app:${marker}@db.invalid/coffeemode\n`);
      fs.writeFileSync(path.join(sandbox, "deploy/dokploy/.env.prod.db.example"), "POSTGRES_PASSWORD=CHANGE_ME\n");
      const out = path.join(sandbox, "out");
      execFileSync(
        "bash",
        [path.join(sandbox, "scripts/devops/backup.sh"), "--env", "prod", "--type", "vol", "--no-upload-r2", "--output-dir", out],
        { encoding: "utf8", env: { ...process.env, R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "" } },
      );
      const archive = fs.readdirSync(out).filter((name) => name.endsWith(".tar.gz")).sort().pop();
      expect(archive, "configuration archive was not created").toBeDefined();
      const entries = execFileSync("tar", ["-tzf", path.join(out, archive ?? "")], { encoding: "utf8" });
      expect(entries).toContain("deploy/dokploy/docker-compose.prod.yml");
      expect(entries).toContain("deploy/dokploy/.env.prod.db.example");
      expect(entries).not.toContain("deploy/dokploy/.env.prod.db\n");
      expect(entries.split("\n")).not.toContain("deploy/dokploy/.env.prod.db");
      expect(entries.split("\n")).not.toContain("deploy/dokploy/.env.prod");
      // Not just the name: no packaged file may carry the marker value.
      const extracted = path.join(sandbox, "extracted");
      fs.mkdirSync(extracted);
      execFileSync("tar", ["-xzf", path.join(out, archive ?? ""), "-C", extracted]);
      const hit = spawnSync("grep", ["-rl", marker, extracted], { encoding: "utf8" });
      expect(hit.status, "the bootstrap marker leaked into the configuration archive").toBe(1);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
