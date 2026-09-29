import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * BRAWUKA-747: env-file value reading and scoped URL resolution live in one
 * shell helper (`scripts/devops/lib/db-url.sh`) shared by the lifecycle
 * entrypoints. This suite is the stub-only CLI matrix for that contract:
 *
 *   explicit override -> <ENV>_DIRECT_URL -> <ENV>_DATABASE_URL (backup/restore
 *   only) -> deploy/dokploy/.env.<env> (DIRECT_URL line first)
 *
 * Nothing here talks to Postgres or the network: every consumer of a selected
 * URL (pg_dump, pg_restore, psql, node) is a stub that records the URL it was
 * handed, so a case asserts which source won instead of trusting log prose.
 * Unscoped ambient DATABASE_URL / DIRECT_URL must never be consulted — the
 * caller's shell cannot silently retarget `--env` (BRAWUKA-241 P0) — and a
 * resolution failure must never echo a credential.
 */
const REPO_ROOT = path.resolve(__dirname, "../../..");
const LIBS = ["scripts/devops/lib/db-url.sh"];
const SCRIPTS = [
  "scripts/devops/backup.sh",
  "scripts/devops/restore.sh",
  "scripts/devops/upgrade-prod.sh",
  "scripts/devops/upgrade-staging.sh",
];

const OVERRIDE_URL = "postgres://override@override.invalid:5432/postgres?sslmode=require";
const STAGING_DIRECT = "postgres://staging-direct@staging-direct.invalid:5432/postgres?sslmode=require";
const STAGING_POOLED = "postgres://staging-pooled@staging-pooled.invalid:6543/postgres?sslmode=require";
const PROD_DIRECT = "postgres://prod-direct@prod-direct.invalid:5432/postgres?sslmode=require";
const PROD_POOLED = "postgres://prod-pooled@prod-pooled.invalid:6543/postgres?sslmode=require";
const FILE_DIRECT = "postgres://file-direct@file-direct.invalid:5432/postgres?sslmode=require";
const FILE_POOLED = "postgres://file-pooled@file-pooled.invalid:6543/postgres?sslmode=require";
const AMBIENT_DIRECT = "postgres://ambient-direct@ambient-direct.invalid:5432/postgres?sslmode=require";
const AMBIENT_POOLED = "postgres://ambient-pooled@ambient-pooled.invalid:6543/postgres?sslmode=require";

// Every stub records its argv (and, for `node`, the DATABASE_URL it received)
// into $STUB_LOG. A real archive, a real restore and a real migration never run.
const PG_DUMP_STUB = `#!/usr/bin/env bash
printf 'pg_dump %s\\n' "$*" >> "$STUB_LOG"
printf 'stub-dump-bytes\\n'
`;

const PG_RESTORE_STUB = `#!/usr/bin/env bash
printf 'pg_restore %s\\n' "$*" >> "$STUB_LOG"
case "$*" in
  *--list*) exit 0 ;;
esac
cat >/dev/null
exit 0
`;

const PSQL_STUB = `#!/usr/bin/env bash
printf 'psql %s\\n' "$*" >> "$STUB_LOG"
sql="$*"
case "$sql" in
  *PostGIS_Version*) printf '3.4 USE_GEOS=1 USE_PROJ=1\\n' ;;
  *ST_DWithin*) printf '2\\n' ;;
  *'count(*) FROM cafes'*) printf '3\\n' ;;
  *'count(*) FROM checkins'*) printf '1\\n' ;;
  *'count(*) FROM profiles'*) printf '1\\n' ;;
esac
exit 0
`;

const SHA256SUM_STUB = `#!/usr/bin/env bash
printf 'sha256sum %s\\n' "$*" >> "$STUB_LOG"
printf '%064d  %s\\n' 0 "\${1:-stub}"
`;

const NODE_STUB = `#!/usr/bin/env bash
printf 'node DATABASE_URL=%s %s\\n' "\${DATABASE_URL:-}" "$*" >> "$STUB_LOG"
exit 0
`;

const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$STUB_LOG"
exit 0
`;

// Staging and production health probes answer a converged release immediately.
const CURL_STUB = `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >> "$STUB_LOG"
body='{"ok":true,"version":"v9.9.9","boot_time":"stub"}'
case "$*" in
  *'%{http_code}'*) printf '%s\\n%s' "$body" '200'; exit 0 ;;
esac
printf '%s' "$body"
`;

const SLEEP_STUB = `#!/usr/bin/env bash
exit 0
`;

const STUBS: Record<string, string> = {
  pg_dump: PG_DUMP_STUB,
  pg_restore: PG_RESTORE_STUB,
  psql: PSQL_STUB,
  sha256sum: SHA256SUM_STUB,
  node: NODE_STUB,
  docker: DOCKER_STUB,
  curl: CURL_STUB,
  sleep: SLEEP_STUB,
};

// Deleted from the child environment unless a case sets them deliberately: the
// suites must never inherit a developer's real target URLs or credentials.
const CLEARED_ENV = [
  "STAGING_DIRECT_URL",
  "STAGING_DATABASE_URL",
  "PROD_DIRECT_URL",
  "PROD_DATABASE_URL",
  "DATABASE_URL",
  "DIRECT_URL",
  "CF_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_BACKUP_BUCKET",
  "DOKPLOY_DEPLOY_URL",
  "DOKPLOY_DEPLOY_TOKEN",
  "STAGING_DOMAIN",
  "PROD_DOMAIN",
];

let tmpRoot = "";
let stubBin = "";
let runIndex = 0;

function scratchPath(rel: string): string {
  return path.join(tmpRoot, rel);
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coffeemode-db-url-select-"));
  stubBin = scratchPath("bin");
  fs.mkdirSync(stubBin);
  for (const [name, source] of Object.entries(STUBS)) {
    const file = path.join(stubBin, name);
    fs.writeFileSync(file, source, { mode: 0o755 });
  }
  fs.mkdirSync(scratchPath("home"));
  // A throwaway checkout: the helper resolves the environment file from the
  // directory it is sourced out of, so nothing here can read a real secrets file.
  fs.cpSync(path.join(REPO_ROOT, "scripts/devops"), scratchPath("repo/scripts/devops"), {
    recursive: true,
  });
  fs.mkdirSync(scratchPath("repo/web/scripts"), { recursive: true });
  fs.writeFileSync(scratchPath("repo/web/scripts/migrate.mjs"), "// stub\n");
  fs.writeFileSync(scratchPath("repo/web/scripts/check-migration-drift.mjs"), "// stub\n");
  fs.writeFileSync(scratchPath("snapshot.dump"), "not-a-real-archive\n");
  fs.mkdirSync(scratchPath("out"));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** All five files this suite ships must exist in the checkout under test. */
for (const rel of [...LIBS, ...SCRIPTS]) {
  it(`ships ${rel}`, () => {
    expect(fs.existsSync(path.join(REPO_ROOT, rel))).toBe(true);
  });
}

interface Run {
  status: number;
  output: string;
  log: string;
}

interface RunOptions {
  /** Environment for the child; `undefined` deletes a cleared variable. */
  env?: Record<string, string | undefined>;
  /** Written to `<scratch>/repo/deploy/dokploy/.env.<env>` for this run only. */
  envFile?: { name: "staging" | "prod"; text: string };
}

function exec(args: string[], options: RunOptions): Run {
  runIndex += 1;
  const envDir = scratchPath("repo/deploy/dokploy");
  fs.rmSync(envDir, { recursive: true, force: true });
  fs.mkdirSync(envDir, { recursive: true });
  if (options.envFile) {
    fs.writeFileSync(path.join(envDir, `.env.${options.envFile.name}`), options.envFile.text);
  }
  const logPath = scratchPath(`invocations-${runIndex}.log`);
  fs.writeFileSync(logPath, "");

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of CLEARED_ENV) delete env[key];
  for (const [key, value] of Object.entries({ ...options.env, STUB_LOG: logPath })) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  env.PATH = `${stubBin}:${env.PATH ?? ""}`;
  env.HOME = scratchPath("home");

  let status = 0;
  let output = "";
  try {
    output = execFileSync("bash", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    status = e.status ?? 1;
    output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  return { status, output, log: fs.readFileSync(logPath, "utf8") };
}

function runScript(script: string, args: string[], options: RunOptions = {}): Run {
  return exec([scratchPath(`repo/${script}`), ...args], options);
}

/** Invoke the helper the way a sourced caller does, from a scratch checkout. */
function resolveUrl(
  env: string,
  override: string,
  scope: "direct" | "pooled",
  options: RunOptions = {},
): Run {
  return exec(
    ["-c", 'set -euo pipefail; source "$0"; db_url_resolve "$@"', scratchPath(`repo/${LIBS[0]}`), env, override, scope],
    options,
  );
}

/** The URL handed to a stubbed consumer, read back from its recorded argv. */
function urlPassedTo(log: string, command: string): string {
  const lines = log.split("\n").filter((entry) => entry.startsWith(`${command} `));
  // Probes like `pg_restore --list <archive>` carry no connection string: the
  // first invocation that received a URL is the one under assertion.
  const line = lines.find((entry) => entry.includes("://"));
  expect(line, `${command} received no URL (recorded: ${lines.join(" | ")})`).toBeDefined();
  return (line ?? "").split(" ").find((field) => field.includes("://")) ?? "";
}

const STAGING_UPGRADE_ARGS = [
  "--skip-backup",
  "--skip-smoke",
  "--image-tag",
  "v9.9.9",
  "--deploy-url",
  "https://dokploy.example.test/api/deploy/staging",
];
const PROD_UPGRADE_ARGS = [
  "--skip-staging-gate",
  "--force-skip-backup",
  "--skip-smoke",
  "--image-tag",
  "v9.9.9",
  "--deploy-url",
  "https://dokploy.example.test/api/deploy/prod",
];

describe("db-url helper — frozen precedence", () => {
  it("ranks override > scoped direct > scoped pooled > file", () => {
    const all = {
      env: { STAGING_DIRECT_URL: STAGING_DIRECT, STAGING_DATABASE_URL: STAGING_POOLED },
      envFile: { name: "staging" as const, text: `DIRECT_URL=${FILE_DIRECT}\nDATABASE_URL=${FILE_POOLED}\n` },
    };
    expect(resolveUrl("staging", OVERRIDE_URL, "pooled", all).output).toBe(OVERRIDE_URL);
    expect(resolveUrl("staging", "", "pooled", all).output).toBe(STAGING_DIRECT);
    expect(resolveUrl("staging", "", "pooled", { ...all, env: { STAGING_DATABASE_URL: STAGING_POOLED } }).output).toBe(
      STAGING_POOLED,
    );
    expect(resolveUrl("staging", "", "pooled", { envFile: all.envFile }).output).toBe(FILE_DIRECT);
    expect(
      resolveUrl("staging", "", "pooled", {
        envFile: { name: "staging", text: `DATABASE_URL=${FILE_POOLED}\n` },
      }).output,
    ).toBe(FILE_POOLED);
  });

  it("treats a scoped variable that is set but blank as absent", () => {
    const run = resolveUrl("staging", "", "pooled", {
      env: { STAGING_DIRECT_URL: "", STAGING_DATABASE_URL: "" },
      envFile: { name: "staging", text: `DIRECT_URL=${FILE_DIRECT}\n` },
    });
    expect(run.status).toBe(0);
    expect(run.output).toBe(FILE_DIRECT);
  });

  it("keeps staging and production sources separate and ignores ambient URLs", () => {
    const ambient = { DATABASE_URL: AMBIENT_POOLED, DIRECT_URL: AMBIENT_DIRECT };
    expect(resolveUrl("staging", "", "pooled", { env: { PROD_DIRECT_URL: PROD_DIRECT, ...ambient } }).status).toBe(1);
    expect(resolveUrl("prod", "", "pooled", { env: { STAGING_DIRECT_URL: STAGING_DIRECT, ...ambient } }).status).toBe(1);
    // A file for the *other* environment is not a source either.
    expect(
      resolveUrl("staging", "", "pooled", {
        envFile: { name: "prod", text: `DIRECT_URL=${FILE_DIRECT}\nDATABASE_URL=${FILE_POOLED}\n` },
      }).status,
    ).toBe(1);
  });

  it("refuses pooled sources in direct scope (migrations)", () => {
    expect(resolveUrl("staging", "", "direct", { env: { STAGING_DATABASE_URL: STAGING_POOLED } }).status).toBe(1);
    expect(
      resolveUrl("staging", "", "direct", { envFile: { name: "staging", text: `DATABASE_URL=${FILE_POOLED}\n` } })
        .status,
    ).toBe(1);
    expect(
      resolveUrl("staging", "", "direct", { env: { STAGING_DIRECT_URL: STAGING_DIRECT } }).output,
    ).toBe(STAGING_DIRECT);
  });

  it("fails with no output when nothing resolves, and trims quotes as before", () => {
    const missing = resolveUrl("staging", "", "pooled", { env: { DATABASE_URL: AMBIENT_POOLED } });
    expect(missing.status).toBe(1);
    expect(missing.output).toBe("");
    const quoted = resolveUrl("staging", "", "pooled", {
      envFile: { name: "staging", text: `DIRECT_URL="${FILE_DIRECT}"\nDATABASE_URL='${FILE_POOLED}'\n` },
    });
    expect(quoted.output).toBe(FILE_DIRECT);
  });
});

describe("backup.sh — dump connection selection", () => {
  it("dumps over the staging-scoped direct URL, never the pooled or ambient one", () => {
    const run = runScript("scripts/devops/backup.sh", ["--env", "staging", "--type", "db", "-o", scratchPath("out")], {
      env: {
        STAGING_DIRECT_URL: STAGING_DIRECT,
        STAGING_DATABASE_URL: STAGING_POOLED,
        DATABASE_URL: AMBIENT_POOLED,
        DIRECT_URL: AMBIENT_DIRECT,
      },
    });
    expect(run.status).toBe(0);
    expect(urlPassedTo(run.log, "pg_dump")).toBe(STAGING_DIRECT);
  });

  it("prefers the pooled scoped URL over the environment file, and the explicit --url over both", () => {
    const options: RunOptions = {
      env: { STAGING_DATABASE_URL: STAGING_POOLED },
      envFile: { name: "staging", text: `DIRECT_URL=${FILE_DIRECT}\nDATABASE_URL=${FILE_POOLED}\n` },
    };
    const args = ["--env", "staging", "--type", "db", "-o", scratchPath("out")];
    expect(urlPassedTo(runScript("scripts/devops/backup.sh", args, options).log, "pg_dump")).toBe(STAGING_POOLED);
    expect(
      urlPassedTo(runScript("scripts/devops/backup.sh", [...args, "--url", OVERRIDE_URL], options).log, "pg_dump"),
    ).toBe(OVERRIDE_URL);
  });

  it("falls back to the environment file, DIRECT_URL line first", () => {
    const run = runScript("scripts/devops/backup.sh", ["--env", "staging", "--type", "db", "-o", scratchPath("out")], {
      envFile: { name: "staging", text: `DIRECT_URL=${FILE_DIRECT}\nDATABASE_URL=${FILE_POOLED}\n` },
    });
    expect(run.status).toBe(0);
    expect(urlPassedTo(run.log, "pg_dump")).toBe(FILE_DIRECT);
  });

  it("fails without leaking another environment's URL when only prod sources exist", () => {
    const run = runScript("scripts/devops/backup.sh", ["--env", "staging", "--type", "db", "-o", scratchPath("out")], {
      env: { PROD_DIRECT_URL: PROD_DIRECT, DATABASE_URL: AMBIENT_POOLED },
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("per-env connection for staging is required");
    expect(run.output).not.toContain(PROD_DIRECT);
    expect(run.output).not.toContain(AMBIENT_POOLED);
    expect(run.log.trim()).toBe("");
  });

  it("is side-effect free under --dry-run even without any source", () => {
    const run = runScript("scripts/devops/backup.sh", ["--env", "staging", "--type", "db", "--dry-run"]);
    expect(run.status).toBe(0);
    expect(run.log.trim()).toBe("");
  });

  it("ships the shared helper inside the configuration archive it uploads", () => {
    const outDir = scratchPath("out");
    const run = runScript("scripts/devops/backup.sh", ["--env", "staging", "--type", "vol", "-o", outDir], {
      env: { STAGING_DIRECT_URL: STAGING_DIRECT },
    });
    expect(run.status).toBe(0);
    const archive = fs
      .readdirSync(outDir)
      .filter((name) => name.endsWith(".tar.gz"))
      .map((name) => path.join(outDir, name))
      .at(-1);
    expect(archive, "no configuration archive was written").toBeDefined();
    const entries = execFileSync("tar", ["-tzf", archive ?? ""], { encoding: "utf8" });
    // The helper is sourced at runtime, so a deployed archive without it would
    // break every entrypoint that ships inside the same tar.
    expect(entries).toContain("scripts/devops/lib/db-url.sh");
    expect(entries).toContain("scripts/devops/backup.sh");
  });
});

describe("restore.sh — live restore and drill selection", () => {
  // Built per test: the scratch root only exists once `beforeAll` has run.
  const liveArgs = () => ["--env", "prod", "--file", scratchPath("snapshot.dump"), "--yes"];

  it("restores over the pooled scoped URL when no direct URL is set", () => {
    const run = runScript("scripts/devops/restore.sh", liveArgs(), { env: { PROD_DATABASE_URL: PROD_POOLED } });
    expect(run.status).toBe(0);
    expect(urlPassedTo(run.log, "pg_restore")).toBe(PROD_POOLED);
    expect(urlPassedTo(run.log, "psql")).toBe(PROD_POOLED);
  });

  it("honors the explicit --url escape hatch over every scoped source", () => {
    const run = runScript("scripts/devops/restore.sh", [...liveArgs(), "--url", OVERRIDE_URL], {
      env: { PROD_DIRECT_URL: PROD_DIRECT, PROD_DATABASE_URL: PROD_POOLED },
    });
    expect(run.status).toBe(0);
    expect(urlPassedTo(run.log, "pg_restore")).toBe(OVERRIDE_URL);
  });

  it("drills into the staging project even when prod sources are exported", () => {
    const run = runScript("scripts/devops/restore.sh", ["--env", "staging", "--drill", "--file", scratchPath("snapshot.dump")], {
      env: { PROD_DIRECT_URL: PROD_DIRECT, STAGING_DATABASE_URL: STAGING_POOLED },
    });
    expect(run.status).toBe(0);
    const created = run.log
      .split("\n")
      .find((line) => line.startsWith("psql ") && line.includes("CREATE DATABASE"));
    expect(created, "no drill scratch database was created").toBeDefined();
    expect(created ?? "").toContain("staging-pooled.invalid");
    expect(created ?? "").not.toContain("prod-");
    expect(urlPassedTo(run.log, "pg_restore")).toContain("staging-pooled.invalid");
  });

  it("keeps the explicit --url override available in drill mode", () => {
    const run = runScript(
      "scripts/devops/restore.sh",
      ["--env", "staging", "--drill", "--file", scratchPath("snapshot.dump"), "--url", OVERRIDE_URL],
      { env: { STAGING_DIRECT_URL: STAGING_DIRECT } },
    );
    expect(run.status).toBe(0);
    // The drill swaps only the database name for its scratch db, so the honored
    // override is proven by the retained credentials, host and port.
    const restored = urlPassedTo(run.log, "pg_restore");
    expect(restored).toContain("override@override.invalid:5432");
    expect(restored).toContain("/restore_drill_");
    expect(restored).not.toContain("staging-direct.invalid");
    expect(urlPassedTo(run.log, "psql")).toContain("override@override.invalid:5432");
  });

  it("names the missing per-env source without printing any credential", () => {
    const run = runScript("scripts/devops/restore.sh", liveArgs(), {
      env: { STAGING_DIRECT_URL: STAGING_DIRECT, DATABASE_URL: AMBIENT_POOLED },
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("Per-env connection string for prod is required");
    expect(run.output).not.toContain(STAGING_DIRECT);
    expect(run.output).not.toContain(AMBIENT_POOLED);
    expect(run.log.trim()).toBe("");
  });

  it("runs no client tooling under --dry-run", () => {
    const run = runScript("scripts/devops/restore.sh", [...liveArgs(), "--dry-run"]);
    expect(run.status).toBe(0);
    expect(run.log.trim()).toBe("");
  });
});

describe("upgrade-staging.sh — direct-only migration selection", () => {
  const env = { CF_ACCESS_CLIENT_ID: "stub-client-id", CF_ACCESS_CLIENT_SECRET: "stub-client-secret" };

  it("migrates over the staging-scoped direct URL and ignores pooled and ambient URLs", () => {
    const run = runScript("scripts/devops/upgrade-staging.sh", STAGING_UPGRADE_ARGS, {
      env: { ...env, STAGING_DIRECT_URL: STAGING_DIRECT, STAGING_DATABASE_URL: STAGING_POOLED, DATABASE_URL: AMBIENT_POOLED },
    });
    expect(run.status).toBe(0);
    expect(run.log).toContain(`node DATABASE_URL=${STAGING_DIRECT} scripts/migrate.mjs`);
  });

  it("honors --db-url over the scoped direct URL", () => {
    const run = runScript("scripts/devops/upgrade-staging.sh", [...STAGING_UPGRADE_ARGS, "--db-url", OVERRIDE_URL], {
      env: { ...env, STAGING_DIRECT_URL: STAGING_DIRECT },
    });
    expect(run.status).toBe(0);
    expect(run.log).toContain(`node DATABASE_URL=${OVERRIDE_URL} scripts/migrate.mjs`);
  });

  it("reads the environment file DIRECT_URL line when no scoped var is exported", () => {
    const run = runScript("scripts/devops/upgrade-staging.sh", STAGING_UPGRADE_ARGS, {
      env,
      envFile: { name: "staging", text: `DIRECT_URL=${FILE_DIRECT}\nDATABASE_URL=${FILE_POOLED}\n` },
    });
    expect(run.status).toBe(0);
    expect(run.log).toContain(`node DATABASE_URL=${FILE_DIRECT} scripts/migrate.mjs`);
  });

  it("refuses a pooled-only configuration for migrations", () => {
    const run = runScript("scripts/devops/upgrade-staging.sh", STAGING_UPGRADE_ARGS, {
      env: { ...env, STAGING_DATABASE_URL: STAGING_POOLED },
      envFile: { name: "staging", text: `DATABASE_URL=${FILE_POOLED}\n` },
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("STAGING session connection is required");
    expect(run.output).not.toContain(STAGING_POOLED);
    expect(run.log).not.toContain("scripts/migrate.mjs");
  });

  it("skips resolution entirely under --dry-run", () => {
    const run = runScript("scripts/devops/upgrade-staging.sh", [...STAGING_UPGRADE_ARGS, "--dry-run"]);
    expect(run.status).toBe(0);
    expect(run.log.trim()).toBe("");
  });
});

describe("upgrade-prod.sh — direct-only migration selection", () => {
  it("migrates over the prod-scoped direct URL", () => {
    const run = runScript("scripts/devops/upgrade-prod.sh", PROD_UPGRADE_ARGS, {
      env: { PROD_DIRECT_URL: PROD_DIRECT, PROD_DATABASE_URL: PROD_POOLED, DATABASE_URL: AMBIENT_POOLED },
    });
    expect(run.status).toBe(0);
    expect(run.log).toContain(`node DATABASE_URL=${PROD_DIRECT} scripts/migrate.mjs`);
  });

  it("refuses a pooled-only configuration for migrations", () => {
    const run = runScript("scripts/devops/upgrade-prod.sh", PROD_UPGRADE_ARGS, {
      env: { PROD_DATABASE_URL: PROD_POOLED },
      envFile: { name: "prod", text: `DATABASE_URL=${FILE_POOLED}\n` },
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("PROD session connection is required");
    expect(run.output).not.toContain(PROD_POOLED);
    expect(run.log).not.toContain("scripts/migrate.mjs");
  });

  it("skips resolution entirely under --dry-run", () => {
    const run = runScript("scripts/devops/upgrade-prod.sh", [...PROD_UPGRADE_ARGS, "--dry-run"]);
    expect(run.status).toBe(0);
    expect(run.log.trim()).toBe("");
  });
});
