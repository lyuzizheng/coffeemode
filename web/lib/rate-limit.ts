import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { rateLimitBuckets, rateLimitConfig } from "@/lib/config";
import type { RateLimitResult, RateLimiterLike } from "@/lib/rate-limit/types";
import { emitRateLimitAlert } from "@/lib/observability/rate-limit-alert";

interface TokenBucket {
  tokens: number;
  resetAt: number;
  windowMs: number;
  maxRequests: number;
  lastAccess: number;
}

// Limit values live in `web/config/rate-limits.yaml` (DG74/DG107); these
// names keep call sites stable while the YAML owns the numbers.
export const IMAGE_RATE_LIMIT = rateLimitConfig("images");

export const PLACES_RATE_LIMIT = rateLimitConfig("places");

/** Reads are cheap; writes fuse cafe + first check-in + stats in one tx. */
export const CAFES_READ_RATE_LIMIT = rateLimitConfig("cafes-read");

export const CAFES_WRITE_RATE_LIMIT = rateLimitConfig("cafes-write");

// Multi-window bucket for search + profile (DG129, #216) — read via helper
export const SEARCH_RATE_LIMITS = rateLimitBuckets("search");
export const PROFILE_READ_RATE_LIMIT = rateLimitConfig("profile-read");
export const PROFILE_WRITE_RATE_LIMIT = rateLimitConfig("profile-write");

/**
 * In-memory token-bucket rate limiter.
 *
 * Intended for per-user/per-IP caps on API routes in single-process or
 * dev setups. For horizontal scale use the Postgres backend — see
 * `createRateLimiter()` and `web/lib/rate-limit/postgres.ts` (issue #23).
 * Buckets are keyed by an arbitrary string (e.g. `images:user:${id}`). A
 * cleanup pass runs every `cleanupEvery` checks to prune stale buckets.
 */
export class RateLimiter implements RateLimiterLike {
  private buckets = new Map<string, TokenBucket>();
  private checksSinceCleanup = 0;

  constructor(private readonly cleanupEvery = 1000) {}

  /**
   * Consume one token for `key` under the given window and cap.
   * Returns the result, including seconds until the next refill.
   */
  async check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.maybeCleanup(now);

    const existing = this.buckets.get(key);
    if (
      !existing ||
      now >= existing.resetAt ||
      existing.windowMs !== windowMs ||
      existing.maxRequests !== maxRequests
    ) {
      const bucket: TokenBucket = {
        tokens: maxRequests - 1,
        resetAt: now + windowMs,
        windowMs,
        maxRequests,
        lastAccess: now,
      };
      this.buckets.set(key, bucket);
      return { allowed: true, remaining: bucket.tokens, resetAt: bucket.resetAt, retryAfter: 0 };
    }

    existing.lastAccess = now;

    if (existing.tokens <= 0) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.resetAt,
        retryAfter: Math.max(0, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    existing.tokens -= 1;
    return {
      allowed: true,
      remaining: existing.tokens,
      resetAt: existing.resetAt,
      retryAfter: 0,
    };
  }

  /** Remove all buckets. Useful in tests and on graceful shutdown. */
  reset() {
    this.buckets.clear();
    this.checksSinceCleanup = 0;
  }

  private maybeCleanup(now: number) {
    this.checksSinceCleanup += 1;
    if (this.checksSinceCleanup < this.cleanupEvery) return;
    this.checksSinceCleanup = 0;

    for (const [key, bucket] of this.buckets) {
      // Prune once the window has passed; an expired bucket is equivalent
      // to a fresh one, so keeping it past reset_at only wastes memory.
      if (now > bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Select the rate-limiter backend for this process.
 *
 * `RATE_LIMIT_BACKEND=postgres|memory` forces a backend; unset, it uses
 * Postgres when `DATABASE_URL` is configured and memory otherwise (dev,
 * tests, CI). Postgres buckets are shared across instances so limits hold
 * under horizontal scale (issue #23).
 *
 * The Postgres backend is loaded lazily via dynamic import: it pulls in the
 * `pg` driver and the DB pool module, which must not be touched by tests or
 * dev processes that never use it (and which would defeat `vi.mock("pg")`).
 */
export async function createRateLimiter(): Promise<RateLimiterLike> {
  const backend =
    process.env.RATE_LIMIT_BACKEND ??
    (process.env.DATABASE_URL ? "postgres" : "memory");
  if (backend !== "postgres") return new RateLimiter();
  const { PostgresRateLimiter } = await import("@/lib/rate-limit/postgres");
  return new PostgresRateLimiter();
}

/**
 * Shared singleton used by route handlers.
 *
 * A lazy proxy: the backend is created on first use and memoized, so the
 * memory-only path never loads the pg module graph (see createRateLimiter).
 */
export const rateLimiter: RateLimiterLike = {
  async check(key, windowMs, maxRequests) {
    return (await getRateLimiter()).check(key, windowMs, maxRequests);
  },
  async reset() {
    return (await getRateLimiter()).reset();
  },
};

let backendPromise: Promise<RateLimiterLike> | null = null;

function getRateLimiter(): Promise<RateLimiterLike> {
  backendPromise ??= createRateLimiter();
  return backendPromise;
}

/**
 * Check one or more windows (DG129 multi-window). Each window is checked
 * sequentially; all windows observe the request. If any window denies,
 * the request is denied and the longest retryAfter wins (client must wait
 * for the slowest window). An alert is emitted via the segregated
 * observability service (DG129) on every denial.
 *
 * Buckets are keyed as `${bucketName}:${clientId}` (single window) or
 * `${bucketName}:${clientId}:${windowMs}` (multi-window) so windows do not collide.
 */
export async function checkRateLimit(
  bucketName: string,
  clientId: string,
  buckets: { windowMs: number; maxRequests: number }[],
  route?: string,
): Promise<RateLimitResult> {
  const baseKey = `${bucketName}:${clientId}`;
  let mostConstrainedAllowed: RateLimitResult | null = null;
  let denied: RateLimitResult | null = null;
  let deniedBucket: { windowMs: number; maxRequests: number } | null = null;

  for (const bucket of buckets) {
    const key = buckets.length > 1 ? `${baseKey}:${bucket.windowMs}` : baseKey;
    const result = await rateLimiter.check(key, bucket.windowMs, bucket.maxRequests);
    if (!result.allowed) {
      if (!denied || result.retryAfter > denied.retryAfter) {
        denied = result;
        deniedBucket = bucket;
      }
    } else if (!mostConstrainedAllowed || result.remaining < mostConstrainedAllowed.remaining) {
      mostConstrainedAllowed = result;
    }
  }

  if (denied && deniedBucket) {
    emitRateLimitAlert({
      bucket: bucketName,
      clientId,
      windowMs: deniedBucket.windowMs,
      maxRequests: deniedBucket.maxRequests,
      retryAfter: denied.retryAfter,
      route,
    });
    return denied;
  }

  // All windows allowed — return the tightest (smallest remaining) that was
  // already consumed above. mostConstrainedAllowed is non-null because
  // buckets is non-empty and no deny occurred.
  return mostConstrainedAllowed!;
}

/**
 * Build a stable identifier for a request.
 *
 * - Signed-in users are keyed by `user:${id}`.
 * - Anonymous requests use a short SHA-256 hash of User-Agent + IP headers.
 * - Local/dev requests with no identifying headers fall back to `anon:local-dev`.
 */
export function getClientIdentifier(request: Request, user?: { id: string } | null): string {
  if (user?.id) return `user:${user.id}`;

  const ua = request.headers.get("user-agent") ?? "";
  // Trust model (review 2026-08-09): Cloudflare sets CF-Connecting-IP on every
  // request it proxies, so it is authoritative when present. X-Real-IP and
  // X-Forwarded-For are client-influenceable (XFF leftmost is trivially
  // spoofable) and are only fallbacks for non-CF deployments. Never let a
  // spoofable header win over the authoritative one.
  const cfIp = request.headers.get("cf-connecting-ip") ?? "";
  const realIp = request.headers.get("x-real-ip") ?? "";
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = cfIp || realIp || forwarded.split(",").pop()?.trim() || "unknown";

  if (!ua && ip === "unknown") {
    return "anon:local-dev";
  }

  const hash = createHash("sha256")
    .update(`${ua}|${ip}`)
    .digest("hex")
    .slice(0, 32);
  return `anon:${hash}`;
}

/** Build a 429 response from a rate-limit result. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", message: "too many requests, please try again later" },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfter) },
    },
  );
}
