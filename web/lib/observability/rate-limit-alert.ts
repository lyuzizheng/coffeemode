import { logWarn } from "./server-log";
import "server-only";

/**
 * Reusable rate-limit observability hook (DG129).
 *
 * Segregated service component per AGENTS.md: feature code composes it,
 * never embeds or duplicates it. On a bucket denial it emits one structured
 * JSON warn line to stdout — the complete record (ADR-0004) — which
 * `otlp-logs.ts` ships to Grafana Cloud Loki (BRAWUKA-607). The Better Stack
 * POST was retired 2026-09-21 (BRAWUKA-605 §6 decision 1: direct cutover, no
 * dual-run). Never throws, never blocks.
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

// Throttle the local console line to 1 per 10s per process to avoid log spam
// under burst. The shipped `logWarn` line is deliberately NOT throttled: a 429
// is a low-frequency security-relevant event, and the whole point of the line
// is to show how often one source was denied (BRAWUKA-607 §6 decision 5).
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
