import { logError } from "./server-log";
import "server-only";

/**
 * Reusable rate-limit observability hook (DG129).
 *
 * Segregated service component per AGENTS.md: feature code composes it,
 * never embeds or duplicates it. Fires a non-blocking alert when a bucket
 * trips. Uses Better Stack when `BETTER_STACK_INGEST_URL` (per-environment
 * source host) is configured, sending `Authorization: Bearer
 * BETTER_STACK_INGEST_TOKEN` when that is also set — staging and prod use
 * different sources (see docs/agent/pending-user-actions.md §7). Locally it
 * is a no-op besides a throttled console.warn.
 */

function betterStackUrl(): string | null {
  const url = process.env.BETTER_STACK_INGEST_URL?.trim();
  return url && url.length > 0 ? url : null;
}

function betterStackToken(): string | null {
  const token = process.env.BETTER_STACK_INGEST_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

interface RateLimitAlertPayload {
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
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = betterStackToken();
    if (token) headers.authorization = `Bearer ${token}`;
    void fetch(ingestUrl, {
      method: "POST",
      headers,
      body,
      keepalive: true,
    }).catch((err) => {
      if (shouldEmit(Date.now())) {
        logError({ route: "rate-limit alert", error: err });
      }
    });
  } catch (err) {
    if (shouldEmit(Date.now())) {
      logError({ route: "rate-limit alert", error: err });
    }
  }
}

/** Reset throttle state — tests only. */
export function _resetAlertThrottleForTests(): void {
  lastEmitAt = 0;
}
