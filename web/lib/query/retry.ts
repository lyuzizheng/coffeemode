/**
 * Query retry policy — pure so it is unit-testable (review 2026-08-09 C4).
 *
 * Do not retry when offline: the browser or the service worker already
 * returned cached data if available, and retrying only burns battery.
 */
export function shouldRetryQuery(failureCount: number, isOnline: boolean): boolean {
  if (!isOnline) return false;
  return failureCount < 2;
}
