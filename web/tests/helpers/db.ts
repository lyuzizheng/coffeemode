import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getPoolConfig } from "@/lib/db/postgres";

export const DEFAULT_DB_URL = "postgres://coffeemode:coffeemode@localhost:5432/coffeemode";
export const DEFAULT_TEMPLATE_DB_NAME = "coffeemode_test_template";

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

export function makeTestSchemaName(prefix = "test_schema"): string {
  return `${prefix}_${process.pid}_${randomUUID().replaceAll("-", "")}`;
}
const ensuredTemplates = new Set<string>();

/**
 * Ensure the template database exists and has all current migrations applied.
 * Uses PostgreSQL advisory locking to coordinate across concurrent Vitest worker
 * threads or runner processes, and terminates active template connections before
 * and after migration to allow subsequent fast-cloning via `CREATE DATABASE ... TEMPLATE`.
 */
export async function ensureTemplateDatabase(
  adminUrl: string,
  templateDbName = DEFAULT_TEMPLATE_DB_NAME,
  force = false,
): Promise<void> {
  if (!force && ensuredTemplates.has(templateDbName)) {
    return;
  }
  const admin = new pg.Client(getPoolConfig(adminUrl));
  await admin.connect();
  try {
    // Advisory lock key derived from template database name to avoid cross-worker races
    await admin.query("SELECT pg_advisory_lock(hashtext($1))", [`template_lock_${templateDbName}`]);
    try {
      if (!force && ensuredTemplates.has(templateDbName)) {
        return;
      }
      const existsRes = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
        templateDbName,
      ]);
      if (existsRes.rows.length === 0) {
        await admin.query(`CREATE DATABASE ${quotedIdentifier(templateDbName)}`);
      }
      // Terminate any leftover connections before migration
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [templateDbName],
      );
      // Run migrations against the template database
      runMigrations(testDatabaseUrl(adminUrl, templateDbName));
      // Terminate connections again after migration so template is clean for cloning
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [templateDbName],
      );
      ensuredTemplates.add(templateDbName);
    } finally {
      await admin.query("SELECT pg_advisory_unlock(hashtext($1))", [`template_lock_${templateDbName}`]);
    }
  } finally {
    await admin.end();
  }
}

export interface ProvisionDbOptions {
  templateDbName?: string;
  useTemplate?: boolean;
}

/**
 * Provision a dedicated test database. By default uses template database cloning
 * for sub-100ms initialization without re-running 15 migrations sequentially.
 */
export async function provisionTestDatabase(
  adminUrl: string,
  testDbName: string,
  options: ProvisionDbOptions = {},
): Promise<void> {
  const useTemplate = options.useTemplate ?? true;
  const templateDbName = options.templateDbName ?? DEFAULT_TEMPLATE_DB_NAME;
  const admin = new pg.Client(getPoolConfig(adminUrl));
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${quotedIdentifier(testDbName)} with (force)`);
    if (useTemplate) {
      await ensureTemplateDatabase(adminUrl, templateDbName);
      await admin.query(
        `create database ${quotedIdentifier(testDbName)} template ${quotedIdentifier(templateDbName)}`,
      );
    } else {
      await admin.query(`create database ${quotedIdentifier(testDbName)}`);
      runMigrations(testDatabaseUrl(adminUrl, testDbName));
    }
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

/**
 * Create a test schema in a shared database for schema-based worker isolation.
 */
export async function createTestSchema(
  client: pg.Client | pg.PoolClient,
  schemaName: string,
): Promise<void> {
  await client.query(`create schema if not exists ${quotedIdentifier(schemaName)}`);
}

/**
 * Drop a test schema and all its objects with CASCADE.
 */
export async function dropTestSchema(
  client: pg.Client | pg.PoolClient,
  schemaName: string,
): Promise<void> {
  await client.query(`drop schema if exists ${quotedIdentifier(schemaName)} cascade`);
}

/**
 * Set the search path for the given PostgreSQL client session.
 */
export async function setSearchPath(
  client: pg.Client | pg.PoolClient,
  ...schemas: string[]
): Promise<void> {
  const pathList = schemas.map(quotedIdentifier).join(", ");
  await client.query(`set search_path to ${pathList}`);
}

/**
 * Run a callback function within an isolated schema, automatically restoring
 * the original search_path and dropping the temporary schema on completion.
 */
export async function withTestSchema<T>(
  client: pg.Client | pg.PoolClient,
  schemaName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const currentPathRes = await client.query<{ search_path: string }>("show search_path");
  const originalPath = currentPathRes.rows[0]?.search_path ?? "public";
  await createTestSchema(client, schemaName);
  await setSearchPath(client, schemaName, "public");
  try {
    return await fn();
  } finally {
    try {
      await dropTestSchema(client, schemaName);
    } finally {
      await client.query(`set search_path to ${originalPath}`);
    }
  }
}

/**
 * Construct a connection URL with search_path set in the options query parameter.
 */
export function schemaDatabaseUrl(baseUrl: string, schemaName: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schemaName},public`);
  return url.toString();
}
