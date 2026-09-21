import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { emitRateLimitAlert } from "@/lib/observability/rate-limit-alert";
import { getRequestId } from "@shared/request-id";

/** Result of consuming one token under a window and cap. */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /** Seconds the client should wait before retrying. */
  retryAfter: number;
}

interface TokenBucket {
  tokens: number;
  resetAt: number;
  windowMs: number;
  maxRequests: number;
  lastAccess: number;
}

// Limit values live in `web/config/rate-limits.yaml` (DG74/DG107) and are
// read at call sites via `rateLimitConfig`/`rateLimitBuckets` from
// `@/lib/config` — no re-exported constants here (BRAWUKA-378 removed the
// dead IMAGE/PLACES/SEARCH/PROFILE aliases).

/**
 * In-memory token-bucket rate limiter (BRAWUKA-378: the sole backend —
 * the Postgres token bucket is deleted; a future multi-instance deploy
 * needs a new shared-store decision).
 *
 * Buckets are keyed by an arbitrary string (e.g. `images:user:${id}`). A
 * cleanup pass runs every `cleanupEvery` checks to prune stale buckets.
 */
export class RateLimiter {
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
 * Shared singleton used by route handlers (BRAWUKA-378: single backend,
 * so no factory or lazy proxy — there is nothing left to select).
 */
export const rateLimiter = new RateLimiter();

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
  // already consumed above. buckets is non-empty and no deny occurred, so
  // mostConstrainedAllowed is set; the throw makes that invariant runtime
  // code instead of a comment (an empty buckets array is a caller bug).
  if (!mostConstrainedAllowed) {
    throw new Error("unreachable: checkRateLimit allowed with no constrained window");
  }
  return mostConstrainedAllowed;
}

/**
 * Build a stable identifier for a request.
 *
 * - Signed-in users are keyed by `user:${id}`.
 * - Anonymous requests are keyed by a short SHA-256 hash of
 *   `cf-connecting-ip` only. `User-Agent` is deliberately excluded: it is
 *   fully client-controlled, so including it would let an anonymous client
 *   mint a fresh `anon:` bucket per request by rotating UA strings.
 * - Requests with no `cf-connecting-ip` share a single `anon:unknown`
 *   bucket (fail-closed). `x-real-ip` / `x-forwarded-for` are never
 *   consulted — both are client-injectable here (Traefik neither sets nor
 *   strips them), and any spoofable fallback reopens the same bypass.
 */
export function getClientIdentifier(request: Request, user?: { id: string } | null): string {
  if (user?.id) return `user:${user.id}`;

  // Trust model (BRAWUKA-282 P1-2): only `cf-connecting-ip` — set by
  // Cloudflare on every request it proxies — is authoritative. Until the
  // trusted-edge header story lands (BRAWUKA-238), non-CF deployments
  // share one coarse bucket rather than a forgeable per-header one.
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return "anon:unknown";

  const hash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return `anon:${hash}`;
}

/** Build a 429 response from a rate-limit result. */
export function rateLimitResponse(result: RateLimitResult, request?: Request): NextResponse {
  // Machine code only — never a `message`: `apiErrorMessage` renders 429s
  // with the caller's localized fallback, so any English prose here would
  // leak into localized UI (BRAWUKA-280). `request_id` rides along so the
  // envelope matches spec 0011 D2.
  return NextResponse.json(
    { error: "rate_limited", request_id: getRequestId(request) },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfter) },
    },
  );
}
