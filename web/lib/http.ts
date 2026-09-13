/**
 * Shared HTTP / fetch defaults.
 *
 * Worker calls (image-service, POI-service) are expected to be fast and
 * local-ish to the Next.js host. A short timeout prevents hanging requests from
 * blocking UI transitions.
 */
export const WORKER_TIMEOUT_MS = 5000;

/**
 * Marker for "the session is gone" (HTTP 401). Carried as an `Error.message`
 * because transport modules (`lib/images/client-upload`, `checkin-api`) cannot
 * hand the `Response` to the surface that owns the sign-in gate. Callers branch
 * on it with `isUnauthorized()`. It is operator vocabulary — never rendered.
 */
export const UNAUTHORIZED = "unauthorized";

/** Machine codes from `apiError()` bodies and client helpers: lower_snake_case only. */
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

/** True when a failure means the session expired rather than the request being wrong. */
export function isUnauthorized(cause: unknown): boolean {
  return cause instanceof Error && cause.message === UNAUTHORIZED;
}

/**
 * Structured triage line for a code that was deliberately kept out of the UI.
 * Diagnosability is the only reason the code is logged at all — do not delete.
 */
function logErrorCode(code: string, context: string): void {
  console.warn("[api-error] machine code withheld from the UI", { code, context });
}

/** Raise the shared session-expired marker — call before `responseMessage`. */
export function throwIfUnauthorized(response: Response): void {
  if (response.status === 401) throw new Error(UNAUTHORIZED);
}

/**
 * Message a failed response should show.
 *
 * `message` is route-authored prose (`apiError()` sets it only when a route
 * wrote one, e.g. the rate limiter) and is safe to render. `error` is a machine
 * code — `internal_error`, `upstream_error`, … — which is operator vocabulary
 * and MUST NOT reach a user: it is logged for triage and replaced with
 * `fallback`, the caller's localized copy (BRAWUKA-212).
 */
export async function responseMessage(response: Response, fallback: string): Promise<string> {
  // Benign: response body may not be JSON (e.g. 502/504 gateway HTML error); safe parse falls back.
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  if (body?.message) return body.message;
  if (body?.error) logErrorCode(body.error, `${response.status} ${response.url}`);
  return fallback;
}

/**
 * Last line of defence for the "no machine code in the UI" invariant, for the
 * failures that never pass through `responseMessage` (client-side upload
 * helpers, hooks). Code-shaped text is logged and replaced by `fallback`;
 * authored prose passes through untouched (BRAWUKA-212).
 */
export function userFacingMessage(message: string, fallback: string): string {
  if (!ERROR_CODE_PATTERN.test(message)) return message;
  logErrorCode(message, "user-facing fallback");
  return fallback;
}
