import { logWarn } from "./server-log";
import "server-only";

/**
 * Reusable rate-limit observability hook (DG129).
 *
 * Segregated service component per AGENTS.md: feature code composes it,
 * never embeds or duplicates it. Fires a non-blocking alert when a bucket
 * trips.
 *
 * One sink: a structured `logWarn` line per event, unthrottled. It reaches
 * Grafana Cloud Loki over OTLP (`otlp-logs.ts`, BRAWUKA-607) carrying
 * `client_ip` for abuse investigation, and its `code: "rate_limited"` is what
 * the `CoffeeMode — Rate-limit flood` alert rule counts (BRAWUKA-611). The
 * third-party POST that used to sit beside it was deleted with the rest of
 * that stack — there is no second sink to keep in sync.
 *
 * The 10s throttle covers the local `console.warn` only.
 */

interface RateLimitAlertPayload {
  bucket: string;
  clientId: string;
  /** Raw `cf-connecting-ip` behind `clientId` — see `ClientIdentity`. */
  clientIp: string | null;
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
  // One structured warn line per event, deliberately NOT throttled: a 429 is a
  // low-frequency security-relevant event, and the whole point of the line is
  // to show how often one source was denied (BRAWUKA-607 §6 decision 5). The
  // throttle below is local noise reduction only.
  logWarn({
    route: payload.route ?? "rate-limit",
    error: "rate_limited",
    status: 429,
    code: "rate_limited",
    clientId: payload.clientId,
    clientIp: payload.clientIp,
    bucket: payload.bucket,
    retryAfter: payload.retryAfter,
  });

  // Throttled console line for local observability / Cloudflare logs.
  if (shouldEmit(Date.now())) {
    console.warn(
      `[rate-limit] bucket=${payload.bucket} client=${payload.clientId} windowMs=${payload.windowMs} max=${payload.maxRequests} retryAfter=${payload.retryAfter}s route=${payload.route ?? "-"}`,
    );
  }
}

/** Reset throttle state — tests only. */
export function _resetAlertThrottleForTests(): void {
  lastEmitAt = 0;
}
