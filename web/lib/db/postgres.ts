import { logError } from "@/lib/observability/server-log";
import "server-only";
import { Pool, type PoolClient, type PoolConfig, type QueryResult } from "pg";

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

export function getPoolConfig(urlString = process.env.DATABASE_URL): PoolConfig {
  if (!urlString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the self-hosted Postgres connection string (see web/.env.example).",
    );
  }

  const url = new URL(urlString);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  // Note: sslrootcert/sslcert/sslkey left in the URL are parsed by pg into its
  // own ssl options, which override config.ssl (pg's connectionString parse
  // wins over top-level config keys).

  const config: PoolConfig = {
    connectionString: url.toString(),
    max: getIntEnv("DATABASE_POOL_MAX", 20),
    idleTimeoutMillis: getIntEnv("DATABASE_POOL_IDLE_TIMEOUT_MS", 30000),
    connectionTimeoutMillis: getIntEnv("DATABASE_POOL_CONNECTION_TIMEOUT_MS", 5000),
    allowExitOnIdle: getBoolEnv("DATABASE_POOL_ALLOW_EXIT_ON_IDLE", false),
  };

  // `get` returns null when the param is absent but "" for `sslmode=` — an
  // empty value must also fail closed, not silently mean plaintext.
  if (sslmode !== null) {
    if (sslmode === "disable") {
      config.ssl = false;
    } else if (sslmode === "allow-self-signed") {
      // Explicit opt-in for self-managed VPS certs without a public CA chain.
      // Encrypts the channel but accepts any certificate — vulnerable to MITM.
      config.ssl = { rejectUnauthorized: false };
    } else if (
      sslmode === "require" ||
      sslmode === "prefer" ||
      sslmode === "verify-ca" ||
      sslmode === "verify-full"
    ) {
      // Strict: validate the CA chain. Node's tls also verifies the hostname
      // by default when a servername is present, so verify-ca and verify-full
      // map to the same behavior here.
      config.ssl = { rejectUnauthorized: true };
    } else {
      // Fail closed: a typo must not silently downgrade to plaintext.
      throw new Error(
        `Unrecognized sslmode "${sslmode}" in DATABASE_URL. Use require, prefer, verify-ca, verify-full, allow-self-signed, or disable.`,
      );
    }
  }

  return config;
}

function attachPoolHandlers(poolInstance: Pool) {
  poolInstance.on("error", (err) => {
    logError({ route: "postgres pool", error: err });
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
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      current.end(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
        // The watchdog must never hold the event loop open on its own.
        // typeof-narrowing: Node runtimes return a Timeout object here.
        if (typeof timer === "object") timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function recordRollbackError(err: unknown, rollbackErr: unknown): void {
  logError({ route: "postgres withTransaction rollback", error: rollbackErr });
  if (!err || typeof err !== "object") return;
  try {
    if (Reflect.get(err, "cause") === undefined) {
      Reflect.set(err, "cause", rollbackErr);
    }
    Reflect.set(err, "rollbackError", rollbackErr);
  } catch {
    // Object may be frozen or non-extensible
  }
}

/**
 * Run a callback inside a transaction. The callback receives a PoolClient
 * that must be used for all queries in the transaction.
 *
 * Single attempt, no automatic retry: a retry must re-enter through
 * `withTransaction` (a fresh connection and transaction), never reuse the
 * released client. Write paths that need an outer retry carry idempotency
 * keys (DG61) so re-entry is safe.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // Subordinate failure: the transaction was aborted by the primary error (err).
      // Rollback failure is secondary (typically because the underlying connection
      // dropped or was terminated).
      //
      // Aggregation strategy: Structured log + subordinate attachment (cause/rollbackError)
      // 1. Primary error thrown first: throwing AggregateError or replacing `err` would
      //    break callers inspecting `err.code` (e.g. Postgres unique violation 23505) or type.
      // 2. Structured logging via `logError`: surfaces the rollback failure immediately in
      //    server-side logs for troubleshooting without mutating caller error flow.
      // 3. Subordinate attachment: attach rollbackErr to `err.cause` (if unset) and `err.rollbackError`
      //    so programmatic inspection can observe both errors while keeping `err` primary.
      recordRollbackError(err, rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transaction-scoped query function: the single query shape every
 * transactional caller shares (spec 0009 §Edge cases 6). `withTransaction`
 * stays the only transaction boundary (BEGIN/COMMIT/ROLLBACK live there);
 * this type only describes how statements run once inside it.
 */
export type TxQueryFn = <T extends Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/**
 * Runs `fn` on a single connection inside a transaction. The callback
 * receives the transaction-scoped {@link TxQueryFn}.
 */
export type RunInTransaction = <T>(fn: (q: TxQueryFn) => Promise<T>) => Promise<T>;

/**
 * Adapt a transaction client to a {@link TxQueryFn} so statements run on
 * the caller's connection (same order, same rollback scope, no new
 * transaction). Replaces the per-callsite `client.query.bind(client)` casts.
 */
export function txQueryFrom(client: PoolClient): TxQueryFn {
  return <T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
    client.query<T>(text, params);
}

/**
 * Adapt a transaction client to a {@link RunInTransaction} for the
 * `inTx`-injected helpers (`recomputeWorkStats`,
 * `incrementalUpdateWorkStats`): their statements join the caller's
 * transaction instead of opening a second one (which would self-deadlock
 * on the held row lock).
 */
export function txRunnerFrom(client: PoolClient): RunInTransaction {
  return (fn) => fn(txQueryFrom(client));
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
        logError({ route: "postgres pool shutdown", error: e });
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
