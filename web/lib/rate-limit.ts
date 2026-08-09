import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

interface TokenBucket {
  tokens: number;
  resetAt: number;
  windowMs: number;
  maxRequests: number;
  lastAccess: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** Seconds the client should wait before retrying. */
  retryAfter: number;
}

export const IMAGE_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 10,
} as const;

export const PLACES_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 30,
} as const;

/**
 * In-memory token-bucket rate limiter.
 *
 * Intended for per-user/per-IP caps on API routes. Buckets are keyed by an
 * arbitrary string (e.g. `images:user:${id}`). A cleanup pass runs every
 * `cleanupEvery` checks to prune stale buckets and prevent unbounded growth.
 */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private checksSinceCleanup = 0;

  constructor(private readonly cleanupEvery = 1000) {}

  /**
   * Consume one token for `key` under the given window and cap.
   * Returns the result, including seconds until the next refill.
   */
  check(key: string, windowMs: number, maxRequests: number): RateLimitResult {
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
      if (now > bucket.resetAt + bucket.windowMs) {
        this.buckets.delete(key);
      }
    }
  }
}

/** Shared singleton used by route handlers. */
export const rateLimiter = new RateLimiter();

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
