import "server-only";

import type { QueryResult } from "pg";
import { query as poolQuery } from "@/lib/db/postgres";
import type { RateLimitResult } from "./types";

/**
 * Postgres-backed token-bucket rate limiter (issue #23).
 *
 * Buckets live in the shared `rate_limits` table, so every app instance
 * (horizontal scale / serverless) reads and writes the same state: a client
 * cannot bypass limits by rotating through instances. Each `check` is ONE
 * atomic UPSERT — refresh-if-expired, else decrement — so concurrent checks
 * cannot lose tokens (row-level locking on the key).
 *
 * Failure policy: fail OPEN. If the database is unavailable, requests are
 * allowed and the error is logged (throttled). Rate limiting is a
 * protection layer; it must not take the API down with it.
 */

export type RateLimitQueryFn = (
  text: string,
  params?: unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

/** Cleanup cadence for pruning expired rows. */
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * Single-statement check: insert a fresh bucket, or on conflict either
 * reset (window/config changed) or decrement. Returns the post-write
 * `tokens` and `reset_at`; the caller maps them to a RateLimitResult.
 * `tokens` may go negative for blocked keys — that is intentional, it
 * counts the excess attempts without extending the window.
 */
export const CHECK_SQL = `
WITH upsert AS (
  INSERT INTO rate_limits (key, tokens, window_ms, max_requests, reset_at, updated_at)
  VALUES (
    $1,
    $4::int - 1,
    $2::bigint,
    $4::int,
    now() + make_interval(secs => $2::bigint / 1000.0),
    now()
  )
  ON CONFLICT (key) DO UPDATE SET
    tokens = CASE
      WHEN rate_limits.reset_at <= now()
        OR rate_limits.window_ms <> $2::bigint
        OR rate_limits.max_requests <> $4::int
      THEN $4::int - 1
      ELSE rate_limits.tokens - 1
    END,
    reset_at = CASE
      WHEN rate_limits.reset_at <= now()
        OR rate_limits.window_ms <> $2::bigint
        OR rate_limits.max_requests <> $4::int
      THEN now() + make_interval(secs => $2::bigint / 1000.0)
      ELSE rate_limits.reset_at
    END,
    updated_at = now()
  RETURNING tokens, reset_at
)
SELECT tokens, reset_at FROM upsert;
`;

/** Map the UPSERT row to a RateLimitResult (pure, unit-tested). */
export function mapBucketRow(
  row: { tokens: unknown; reset_at: unknown },
  now: number,
): RateLimitResult {
  const tokens = Number(row.tokens);
  const resetAt = row.reset_at instanceof Date ? row.reset_at.getTime() : Number(row.reset_at);
  return {
    allowed: tokens >= 0,
    remaining: Math.max(0, tokens),
    resetAt,
    retryAfter: Math.max(0, Math.ceil((resetAt - now) / 1000)),
  };
}

export class PostgresRateLimiter {
  private lastCleanup = 0;
  private lastErrorLog = 0;

  constructor(
    private readonly run: RateLimitQueryFn = poolQuery,
    private readonly now: () => number = Date.now,
  ) {}

  async check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const now = this.now();
    try {
      await this.maybeCleanup(now);
      const result = await this.run(CHECK_SQL, [key, windowMs, maxRequests]);
      const row = result.rows[0];
      if (!row) {
        // The CTE always returns exactly one row; treat absence as a
        // storage-layer anomaly and fail open.
        this.logError("rate-limiter returned no row", null);
        return this.failOpenResult(now);
      }
      return mapBucketRow(row as { tokens: unknown; reset_at: unknown }, now);
    } catch (err) {
      this.logError("rate-limiter check failed, failing open", err);
      return this.failOpenResult(now);
    }
  }

  /** Remove all buckets (tests, graceful shutdown). */
  async reset(): Promise<void> {
    await this.run("DELETE FROM rate_limits");
  }

  private async maybeCleanup(now: number): Promise<void> {
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;
    // Rows whose window has passed are dead weight; any concurrent check
    // recreates its key atomically, so this DELETE is always safe.
    await this.run("DELETE FROM rate_limits WHERE reset_at < now()");
  }

  private failOpenResult(now: number): RateLimitResult {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAt: now, retryAfter: 0 };
  }

  private logError(message: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 60_000) return; // throttle to 1/min
    this.lastErrorLog = now;
    console.error(message, err);
  }
}
