import "server-only";

/**
 * Reusable rate-limit observability hook (DG129).
 *
 * Segregated service component per AGENTS.md: feature code composes it,
 * never embeds or duplicates it. Fires a non-blocking alert when a bucket
 * trips. Uses Better Stack (owner action pending — see
 * docs/agent/pending-user-actions.md §7) when `BETTER_STACK_INGEST_URL` is
 * configured; locally it is a no-op besides a throttled console.warn.
 */

export interface RateLimitAlertPayload {
  bucket: string;
  clientId: string;
  windowMs: number;
  maxRequests: number;
  retryAfter: number;
  route?: string;
}

// Throttle alerts to 1 per 10s per process to avoid log spam under burst.
let lastEmitAt = 0;
const EMIT_THROTTLE_MS = 10_000;

function shouldEmit(now: number): boolean {
  if (now - lastEmitAt < EMIT_THROTTLE_MS) return false;
  lastEmitAt = now;
  return true;
}

function betterStackUrl(): string | null {
  const url = process.env.BETTER_STACK_INGEST_URL?.trim();
  return url && url.length > 0 ? url : null;
}

/**
 * Fire-and-forget alert. Never throws, never blocks the caller.
 * Safe to call without awaiting.
 */
export function emitRateLimitAlert(payload: RateLimitAlertPayload): void {
  const now = Date.now();

  // Always log throttled for local observability / Cloudflare logs.
  if (shouldEmit(now)) {
    console.warn(
      `[rate-limit] bucket=${payload.bucket} client=${payload.clientId} windowMs=${payload.windowMs} max=${payload.maxRequests} retryAfter=${payload.retryAfter}s route=${payload.route ?? "-"}`,
    );
  }

  const ingestUrl = betterStackUrl();
  if (!ingestUrl) return;

  // Fire-and-forget POST to Better Stack ingest. Do not await.
  // Use keepalive so it survives response finish.
  try {
    const body = JSON.stringify({
      dt: new Date(now).toISOString(),
      level: "warn",
      event: "rate_limited",
      bucket: payload.bucket,
      client_id: payload.clientId,
      window_ms: payload.windowMs,
      max_requests: payload.maxRequests,
      retry_after: payload.retryAfter,
      route: payload.route ?? null,
    });

    // Intentionally not awaited — alert must not slow the 429 response.
    void fetch(ingestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch((err) => {
      if (shouldEmit(Date.now())) {
        console.error("[rate-limit] Better Stack ingest failed", err);
      }
    });
  } catch (err) {
    if (shouldEmit(Date.now())) {
      console.error("[rate-limit] Better Stack alert construction failed", err);
    }
  }
}

/** Reset throttle state — tests only. */
export function _resetAlertThrottleForTests(): void {
  lastEmitAt = 0;
}
