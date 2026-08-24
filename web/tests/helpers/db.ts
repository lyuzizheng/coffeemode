import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPoolConfig } from "@/lib/db/postgres";

export const DEFAULT_DB_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function integrationAdminUrl(): string {
  const raw = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const url = new URL(raw);
  const remoteOptIn = process.env.ALLOW_REMOTE_INTEGRATION_DB === "1";
  const hasConnectionHostOverride = ["host", "hostaddr", "socketPath"].some((name) =>
    url.searchParams.has(name),
  );
  const isLocalHost = url.hostname === "" || LOCAL_DB_HOSTS.has(url.hostname);
  if (!remoteOptIn && (hasConnectionHostOverride || !isLocalHost)) {
    throw new Error(
      `Refusing real-DB integration against non-local or overridden host ${url.hostname || "(empty)"}; set ALLOW_REMOTE_INTEGRATION_DB=1 only for an explicitly disposable test server`,
    );
  }
  return url.toString();
}

export function testDatabaseUrl(adminUrl: string, testDbName: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${testDbName}`;
  return url.toString();
}

export function makeTestDbName(prefix = "coffeemode_test"): string {
  return `${prefix}_${process.pid}_${randomUUID().replaceAll("-", "")}`;
}

export async function provisionTestDatabase(adminUrl: string, testDbName: string): Promise<void> {
  const admin = new pg.Client(getPoolConfig(adminUrl));
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${quotedIdentifier(testDbName)} with (force)`);
    await admin.query(`create database ${quotedIdentifier(testDbName)}`);
  } finally {
    await admin.end();
  }
}

/** Apply migrations using the same runner the CLI uses (dogfooding). */
export function runMigrations(url: string): void {
  execFileSync("node", ["scripts/migrate.mjs"], {
    cwd: WEB_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
