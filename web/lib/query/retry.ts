import { ApiError, RETRY_AFTER_CAP_MS } from "@/lib/http";

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
 * - Mutations never reach this. The global default is `retry: 0`; the single
 *   exception is the like toggle's own local policy (BRAWUKA-1020).
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
 * Delay before the next query attempt. A 429 honors the server's
 * `Retry-After`, bounded by `RETRY_AFTER_CAP_MS` so a buggy upstream cannot
 * park a background query for minutes; everything else uses TanStack's
 * exponential backoff (1s, 2s, … capped at 30s).
 */
export function queryRetryDelay(failureCount: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, RETRY_AFTER_CAP_MS);
  }
  return Math.min(1000 * 2 ** failureCount, 30_000);
}
