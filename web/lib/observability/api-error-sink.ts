import "server-only";

/**
 * Better Stack sink for the API error JSON lines (spec 0011 D8, BRAWUKA-541).
 *
 * Ships every `logError`/`logWarn` line — the failure record the app already
 * writes to stdout — to the per-environment `coffeemode-api-errors` source, so
 * Better Stack can chart 5xx-by-`route` and the error-`code` histogram and
 * alert on them. Same ingest pattern as `rate-limit-alert.ts`:
 * `BETTER_STACK_ERRORS_INGEST_URL` (source host) + `Authorization: Bearer
 * BETTER_STACK_ERRORS_INGEST_TOKEN`, staging and prod on separate sources
 * (docs/agent/pending-user-actions.md §7). Locally it is a no-op.
 *
 * Only error/warn lines are shipped, not the proxy's `type:"access"` lines:
 * the proxy runs before routing, so its response is always the 200
 * `NextResponse.next()` — it never sees the route's status or envelope code
 * (verified against a running dev server: a 404 page logs `"status":200`).
 * The error lines carry the real `status` and `code`, so they are the only
 * usable metric source. Stdout stays the complete record (ADR-0004).
 *
 * Never throws and never blocks: the POST is fire-and-forget with `keepalive`
 * so it survives the response, exactly like the rate-limit alert. Failures are
 * reported with a throttled structured `console.warn` rather than `logError` —
 * routing them through the logger would re-enter this sink on every failure.
 */

function ingestUrl(): string | null {
  const url = process.env.BETTER_STACK_ERRORS_INGEST_URL?.trim();
  return url && url.length > 0 ? url : null;
}

function ingestToken(): string | null {
  const token = process.env.BETTER_STACK_ERRORS_INGEST_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

// Throttle sink-failure reports to 1 per 10s per process: a Better Stack
// outage must not turn every failing request into another log line.
let lastFailureAt = 0;
const FAILURE_THROTTLE_MS = 10_000;

function reportFailure(err: unknown): void {
  const now = Date.now();
  if (now - lastFailureAt < FAILURE_THROTTLE_MS) return;
  lastFailureAt = now;
  console.warn(
    JSON.stringify({
      type: "warn",
      request_id: null,
      route: "api-error-sink",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/**
 * Ship one already-shaped log line to the `coffeemode-api-errors` source.
 * Fire-and-forget; safe to call without awaiting, and safe to call when the
 * source is not configured (local dev, tests).
 */
export function shipApiErrorLine(line: Record<string, unknown>): void {
  const url = ingestUrl();
  if (!url) return;

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = ingestToken();
    if (token) headers.authorization = `Bearer ${token}`;

    // Intentionally not awaited — observability must not slow the response.
    void fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(line),
      keepalive: true,
    }).catch(reportFailure);
  } catch (err) {
    reportFailure(err);
  }
}

/** Reset throttle state — tests only. */
export function _resetSinkThrottleForTests(): void {
  lastFailureAt = 0;
}
