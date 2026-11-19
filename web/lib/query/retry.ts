import { ApiError } from "@/lib/http";

/**
 * Query retry policy — pure so it is unit-testable (review 2026-08-09 C4,
 * spec 0011 D9).
 *
 * - Offline → never: the browser or the service worker already returned
 *   cached data if available, and retrying only burns battery.
 * - `ApiError` 4xx → never: the caller can fix nothing by resending (401/403/
 *   404/422…). 429 is the single exception — it retries exactly once, after
 *   the server's `Retry-After` (see `queryRetryDelay`).
 * - `ApiError` 5xx and network failures (fetch `TypeError`, anything that is
 *   not an `ApiError`) → at most two retries.
 * - Mutations use `shouldRetryMutation` below, never this.
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
  isOnline: boolean,
): boolean {
  if (!isOnline) return false;
  if (error instanceof ApiError) {
    if (error.status === 429) return failureCount === 0;
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 2;
}

/**
 * Mutation retry policy — BRAWUKA-1020, the narrow exception to spec 0011's
 * "mutations never retry".
 *
 * A mutation normally must not replay: a 5xx or a dropped connection may
 * have committed, and re-sending a toggle would flip it twice. `429` is the
 * one failure class that cannot have applied state — the app's `guard()`
 * rejects before the handler runs, and a pre-origin edge 429 never reaches
 * the app — so replaying it once is safe for every mutation and absorbs a
 * transient rate limit without making the user click again. Everything else
 * stays `retry: 0`. Callers opt in per mutation; the global mutation
 * defaults in `client.ts` are untouched.
 */
export function shouldRetryMutation(failureCount: number, error: unknown): boolean {
  return failureCount === 0 && error instanceof ApiError && error.status === 429;
}

/**
 * Delay before the next attempt. A 429 honors the server's `Retry-After`
 * (parsed and capped by `apiFetch`); everything else uses TanStack's
 * exponential backoff (1s, 2s, … capped at 30s).
 */
export function queryRetryDelay(failureCount: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs !== undefined) {
    return error.retryAfterMs;
  }
  return Math.min(1000 * 2 ** failureCount, 30_000);
}
