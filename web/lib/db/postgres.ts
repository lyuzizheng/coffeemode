import "server-only";
import { Pool, type PoolClient, type PoolConfig } from "pg";

/**
 * Self-hosted Postgres connection pool (spec 0001 / ADR-0002, decision #25).
 *
 * Server-side only — the browser never talks to Postgres. Every route handler
 * verifies the Supabase session before touching this pool.
 */

let pool: Pool | null = null;
let shutdownHandlersRegistered = false;

function getIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower === "1" || lower === "true") return true;
  if (lower === "0" || lower === "false") return false;
  console.warn(
    `Unrecognized boolean value for ${name}: "${raw}"; using fallback ${fallback}.`,
  );
  return fallback;
}

export function getPoolConfig(): PoolConfig {
  const urlString = process.env.DATABASE_URL;
  if (!urlString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the self-hosted Postgres connection string (see web/.env.example).",
    );
  }

  const url = new URL(urlString);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");

  const config: PoolConfig = {
    connectionString: url.toString(),
    max: getIntEnv("DATABASE_POOL_MAX", 20),
    idleTimeoutMillis: getIntEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 30000),
    connectionTimeoutMillis: getIntEnv("DATABASE_POOL_CONNECTION_TIMEOUT_MS", 5000),
    allowExitOnIdle: getBoolEnv("DATABASE_POOL_ALLOW_EXIT_ON_IDLE", false),
  };

  if (sslmode) {
    if (sslmode === "require" || sslmode === "prefer") {
      // Self-managed VPS certs are usually self-signed or Let's Encrypt.
      // We still encrypt the channel without validating the CA chain.
      config.ssl = { rejectUnauthorized: false };
    } else if (sslmode === "disable") {
      config.ssl = false;
    } else if (sslmode === "verify-ca" || sslmode === "verify-full") {
      config.ssl = true;
    } else {
      console.warn(
        `Unrecognized sslmode "${sslmode}" in DATABASE_URL; connection will not use SSL. Use require, prefer, disable, verify-ca, or verify-full.`,
      );
    }
  }

  return config;
}

function attachPoolHandlers(poolInstance: Pool) {
  poolInstance.on("error", (err) => {
    console.error("Postgres pool error:", err);
  });
}

/**
 * Lazily-created shared pool. Throws at call time (not import time) when
 * DATABASE_URL is unset, so builds and CI run without credentials.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
    attachPoolHandlers(pool);
  }
  return pool;
}

/** Close the shared pool. Safe to call multiple times (idempotent). */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

/**
 * Run a callback inside a transaction. The callback receives a PoolClient
 * that must be used for all queries in the transaction.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Register SIGTERM/SIGINT handlers that close the pool and let the process
 * exit naturally. Call this from an explicit lifecycle entry point such as
 * `web/instrumentation.ts` instead of auto-registering at import time, so
 * the module can be safely imported in test and build contexts.
 */
export function registerPoolShutdownHandlers() {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;

  if (typeof process === "undefined") return;

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, async () => {
      try {
        await closePool();
        process.exitCode = 0;
      } catch (e) {
        console.error(`Error closing Postgres pool during ${signal}:`, e);
        process.exitCode = 1;
        setTimeout(() => process.exit(process.exitCode ?? 1), 5000).unref();
      }
    });
  }
}

/** Run a query against the shared pool. Thin convenience wrapper. */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) {
  const result = await getPool().query<T>(text, params);
  return result;
}
