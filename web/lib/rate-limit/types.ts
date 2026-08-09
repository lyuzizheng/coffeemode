/**
 * Shared rate-limiter types (issue #23).
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** Seconds the client should wait before retrying. */
  retryAfter: number;
}

/**
 * The public limiter contract. `check()` is async for every backend — the
 * Postgres backend issues one atomic UPSERT, and the memory backend is
 * async-adapted so call sites behave identically under either backend.
 * `reset()` is used by tests and graceful shutdown.
 */
export interface RateLimiterLike {
  check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>;
  reset(): void | Promise<void>;
}
