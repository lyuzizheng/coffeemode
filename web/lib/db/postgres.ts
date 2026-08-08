import { Pool, type PoolConfig } from "pg";

/**
 * Self-hosted Postgres connection pool (spec 0001 / ADR-0002).
 *
 * Server-side only — the browser never talks to Postgres. Every route handler
 * verifies the Supabase session before touching this pool.
 */

let pool: Pool | null = null;

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

  const config: PoolConfig = { connectionString: url.toString() };

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

/**
 * Lazily-created shared pool. Throws at call time (not import time) when
 * DATABASE_URL is unset, so builds and CI run without credentials.
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
  }
  return pool;
}

/** Run a query against the shared pool. Thin convenience wrapper. */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) {
  const result = await getPool().query<T>(text, params);
  return result;
}
