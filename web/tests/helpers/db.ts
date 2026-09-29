import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { closePool, getPoolConfig } from "@/lib/db/postgres";
import {
  assertSafeSeedTarget,
  DEFAULT_DB_URL,
  evaluateRemoteTarget,
} from "../../scripts/lib/test-db-policy.mjs";

export interface TestDatabaseContext {
  testDbName: string;
  testDbUrl: string;
  adminDbUrl: string;
  dbClient: pg.Client;
  previousDatabaseUrl: string | undefined;
}

/**
 * Lifecycle helper for real-DB integration suites.
 * Provisions an isolated scratch DB from template, sets DATABASE_URL,
 * resets the shared connection pool, and connects a raw seeder client.
 */
export async function setupTestDatabase(
  prefix: string,
  options: ProvisionDbOptions = {},
): Promise<TestDatabaseContext> {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const adminDbUrl = integrationAdminUrl();
  const testDbName = makeTestDbName(prefix);
  const testDbUrl = testDatabaseUrl(adminDbUrl, testDbName);
  await provisionTestDatabase(adminDbUrl, testDbName, options);
  process.env.DATABASE_URL = testDbUrl;
  await closePool();
  const dbClient = new pg.Client(getPoolConfig(testDbUrl));
  await dbClient.connect();
  return {
    testDbName,
    testDbUrl,
    adminDbUrl,
    dbClient,
    previousDatabaseUrl,
  };
}

/**
 * Safely tear down a real-DB integration suite:
 * Closes the shared pool and raw client, drops the scratch DB via admin connection,
 * and restores the previous DATABASE_URL even on failures.
 */
export async function teardownTestDatabase(
  ctx: Pick<TestDatabaseContext, "testDbName" | "adminDbUrl" | "testDbUrl" | "dbClient" | "previousDatabaseUrl">,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await closePool();
  } catch (error) {
    errors.push(error);
  }
  try {
    await ctx.dbClient?.end();
  } catch (error) {
    errors.push(error);
  }
  if (ctx.testDbUrl) {
    try {
      await cleanupIntegrationDatabase(ctx.adminDbUrl, ctx.testDbName);
    } catch (error) {
      errors.push(error);
    }
  }
  if (ctx.previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ctx.previousDatabaseUrl;
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "real-DB integration cleanup failed");
  }
}

export const DEFAULT_TEMPLATE_DB_NAME = "coffeemode_test_template";

/**
 * Guard a seeder holding an open client: the name comes from the server, not the
 * caller. The dev-database policy itself lives in `scripts/lib/test-db-policy.mjs`
 * (`assertSafeSeedTarget`), shared with the script-side seeders.
 */
export async function assertSafeSeedClient(dbClient: pg.Client, seeder: string, configUrl?: string): Promise<void> {
  const { rows } = await dbClient.query<{ db_name: string }>("select current_database() as db_name");
  assertSafeSeedTarget(rows[0]?.db_name ?? "", { seeder, configUrl });
}

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function integrationAdminUrl(): string {
  const raw = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const { url, refusal } = evaluateRemoteTarget(raw, { action: "real-DB integration" });
  if (refusal) throw new Error(refusal);
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

const ensuredTemplates = new Set<string>();

async function internalEnsureTemplate(
  admin: pg.Client,
  adminUrl: string,
  templateDbName: string,
): Promise<void> {
  if (ensuredTemplates.has(templateDbName)) {
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
}

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
  if (force) {
    ensuredTemplates.delete(templateDbName);
  }
  if (ensuredTemplates.has(templateDbName)) {
    return;
  }
  const admin = new pg.Client(getPoolConfig(adminUrl));
  await admin.connect();
  try {
    // Advisory lock key derived from template database name to avoid cross-worker races
    await admin.query("SELECT pg_advisory_lock(hashtext($1))", [`template_lock_${templateDbName}`]);
    try {
      await internalEnsureTemplate(admin, adminUrl, templateDbName);
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
 * Holds an advisory lock across template verification and CREATE DATABASE ... TEMPLATE
 * to eliminate cross-process races between template migration connections and cloning.
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
      await admin.query("SELECT pg_advisory_lock(hashtext($1))", [`template_lock_${templateDbName}`]);
      try {
        await internalEnsureTemplate(admin, adminUrl, templateDbName);
        await admin.query(
          `create database ${quotedIdentifier(testDbName)} template ${quotedIdentifier(templateDbName)}`,
        );
      } finally {
        await admin.query("SELECT pg_advisory_unlock(hashtext($1))", [`template_lock_${templateDbName}`]);
      }
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
 * Safely clean up and drop a dedicated test database after integration tests.
 * Configures bounded timeouts to prevent connection hangs and eliminate afterAll timeouts.
 */
export async function cleanupIntegrationDatabase(
  adminUrl: string,
  testDbName: string,
): Promise<void> {
  const config = getPoolConfig(adminUrl);
  const admin = new pg.Client({
    ...config,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  try {
    await admin.connect();
    await admin.query(`drop database if exists ${quotedIdentifier(testDbName)} with (force)`);
  } finally {
    // Benign: best-effort teardown client termination.
    await admin.end().catch(() => {});
  }
}
