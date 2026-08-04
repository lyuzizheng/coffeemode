import { Pool, neonConfig } from "@neondatabase/serverless";

/**
 * Neon Postgres connection pool (spec 0001: ALL DATA lives in Neon).
 *
 * Server-side only — the browser never talks to Neon. Every route handler
 * verifies the Supabase session before touching this pool.
 *
 * Node 22 ships a stable native WebSocket, so the pooled transport needs
 * no `ws` shim; wire it explicitly so behavior doesn't depend on the
 * driver's environment sniffing.
 */
neonConfig.webSocketConstructor = WebSocket;

let pool: Pool | null = null;

/**
 * Lazily-created shared pool. Throws at call time (not import time) when
 * DATABASE_URL is unset, so builds and CI run without credentials.
 */
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the Neon pooled connection string (see web/.env.example).",
    );
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
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
