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

/**
 * Who a request is rate-limited as, plus the raw source behind it.
 *
 * `id` is the bucket key — a hash for anonymous callers, so it can show that
 * one source tripped 500 times but cannot be turned back into an address.
 * `ip` is the unhashed `cf-connecting-ip`, carried only so an abuse alert can
 * name the source (BRAWUKA-607 §6 decision 5); it never becomes a bucket key.
 */
export interface ClientIdentity {
  id: string;
  ip: string | null;
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
 * cleanup pass runs every `cleanupEvery` checks to prune stale buckets,
 * and new keys beyond `maxBuckets` evict the least-recently-used bucket
 * first — so the Map stays bounded even under a burst of unique client
 * ids between cleanups (BRAWUKA-654).
 */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private checksSinceCleanup = 0;

  /**
   * @param cleanupEvery run the expired-bucket sweep every N checks.
   * @param maxBuckets hard cap on live entries: inserting a new key while
   *   full evicts the least-recently-used bucket first, so the Map cannot
   *   grow without bound when flooded with unique client ids.
   */
  constructor(
    private readonly cleanupEvery = 1000,
    private readonly maxBuckets = 10_000,
  ) {}

  /**
   * Consume one token for `key` under the given window and cap.
   * Returns the result, including seconds until the next refill.
   */
  async check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.maybeCleanup(now);

    const existing = this.buckets.get(key);
    if (
      existing &&
      now < existing.resetAt &&
      existing.windowMs === windowMs &&
      existing.maxRequests === maxRequests
    ) {
      // Live-bucket hit: refresh recency (Map is insertion-ordered, so
      // delete + set moves the key to the tail = most-recently-used).
      this.buckets.delete(key);
      existing.lastAccess = now;
      this.buckets.set(key, existing);

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

    // New key, expired bucket, or changed window/cap: (re)create.
    if (!this.buckets.has(key)) {
      this.evictOldestIfFull();
    } else {
      // Expired/stale entry re-created as most-recently-used.
      this.buckets.delete(key);
    }
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

  /**
   * Make room for one new key. The Map is insertion-ordered with hits
   * re-inserted at the tail, so the head is the least-recently-used
   * bucket — evicting it bounds memory under unique-key floods.
   */
  private evictOldestIfFull() {
    if (this.buckets.size < this.maxBuckets) return;
    const oldest = this.buckets.keys().next().value;
    if (oldest !== undefined) this.buckets.delete(oldest);
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
  client: ClientIdentity,
  buckets: { windowMs: number; maxRequests: number }[],
  route?: string,
): Promise<RateLimitResult> {
  const baseKey = `${bucketName}:${client.id}`;
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
      clientId: client.id,
      clientIp: client.ip,
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
 * Build the rate-limit identity for a request.
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
 *
 * The header is read exactly once and returned alongside the key, so an abuse
 * alert can name the source without a second, independently-trusted read.
 */
export function getClientIdentity(
  request: Request,
  user?: { id: string } | null,
): ClientIdentity {
  if (user?.id) return { id: `user:${user.id}`, ip: null };

  // Trust model (BRAWUKA-282 P1-2): only `cf-connecting-ip` — set by
  // Cloudflare on every request it proxies — is authoritative. Direct-origin
  // traffic that skips Cloudflare can set this header itself, so on that
  // path it is just a self-chosen bucket label: rotating it mints a fresh
  // bucket per request, so the limiter does not bind direct-origin floods
  // at all. The real fix is trusted-edge enforcement (BRAWUKA-238); the
  // billed-upstream brake it used to provide is gone — anonymous live
  // fanout is coerced to stored-only instead (BRAWUKA-621), and the
  // single-instance bucket itself is accepted in ADR-0006 (BRAWUKA-637).
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return { id: "anon:unknown", ip: null };

  const hash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return { id: `anon:${hash}`, ip };
}

/** Build a 429 response from a rate-limit result. */
export function rateLimitResponse(
  result: RateLimitResult,
  request?: Request,
  options?: { requestId?: string },
): NextResponse {
  // Machine code only — never a `message`: `apiErrorMessage` renders 429s
  // with the caller's localized fallback, so any English prose here would
  // leak into localized UI (BRAWUKA-280). `request_id` rides along so the
  // envelope matches spec 0011 D2.
  return NextResponse.json(
    { error: "rate_limited", request_id: options?.requestId ?? getRequestId(request) },
    {
      status: 429,
      headers: { "Retry-After": String(result.retryAfter) },
    },
  );
}
