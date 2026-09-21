import type { useTranslations } from "next-intl";
import { isErrorCode, type ErrorCode } from "@shared/errors";

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
 * Structured triage line for error detail that is deliberately kept out of
 * the UI — machine codes, server `message` prose, non-envelope bodies.
 * Diagnosability is the only reason these are logged at all — do not delete.
 * `context` carries status + sanitized URL: the query string is stripped
 * because user input (`/api/search?q=…`) must not reach logs (spec 0011 D7,
 * audit P2).
 */
function logErrorCode(code: string, context: string): void {
  console.warn("[api-error] detail withheld from the UI", { code, context });
}

/** Origin + path only — query strings carry user input and never reach logs. */
function stripQuery(url: string): string {
  return url.split(/[?#]/, 1)[0] ?? url;
}

/**
 * Cap on a server-supplied `Retry-After`: a buggy upstream must not park a
 * query for minutes. Matches the order of TanStack's default backoff cap.
 */
export const RETRY_AFTER_CAP_MS = 30_000;

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into a delay in
 * ms, capped at `RETRY_AFTER_CAP_MS`. Absent/unparseable → `undefined`.
 */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  const ms = Number.isNaN(seconds) ? Date.parse(trimmed) - Date.now() : seconds * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, RETRY_AFTER_CAP_MS);
}

/**
 * Client-side API failure (spec 0011 D9, BRAWUKA-538). `apiFetch` throws this
 * for every non-2xx response; `code` is always a registered machine code —
 * unparseable or unenveloped bodies normalize to `internal_error`.
 *
 * `message` stays machine vocabulary (`code`, or the `UNAUTHORIZED` marker on
 * 401) so `isUnauthorized()` keeps working and `err.message` can never leak
 * server-authored English into a localized surface. The server's prose is
 * preserved on `serverMessage` for logs only — render via `apiErrorMessage`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  /** Server-authored diagnostic (envelope `message`). Logs only — never render. */
  readonly serverMessage?: string;
  /** Parsed `Retry-After` delay on 429 responses; the retry policy honors it once. */
  readonly retryAfterMs?: number;

  constructor(init: {
    status: number;
    code: ErrorCode;
    details?: Record<string, unknown>;
    requestId?: string;
    serverMessage?: string;
    retryAfterMs?: number;
  }) {
    super(init.status === 401 ? UNAUTHORIZED : init.code);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    if (init.details !== undefined) this.details = init.details;
    if (init.requestId !== undefined) this.requestId = init.requestId;
    if (init.serverMessage !== undefined) this.serverMessage = init.serverMessage;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
  }
}

interface ApiErrorEnvelope {
  error?: unknown;
  message?: unknown;
  details?: unknown;
  request_id?: unknown;
  /** Legacy top-level extras — folded into `details` for one release (D2). */
  cafe_id?: unknown;
  existing_checkin_id?: unknown;
  n?: unknown;
}

function mergeDetails(body: ApiErrorEnvelope): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const key of ["cafe_id", "existing_checkin_id", "n"] as const) {
    if (body[key] !== undefined) merged[key] = body[key];
  }
  if (typeof body.details === "object" && body.details !== null) {
    Object.assign(merged, body.details);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * The only browser entry point for `/api/*` (spec 0011 D9). Returns the
 * parsed JSON body on 2xx (`undefined` for an empty body); throws `ApiError`
 * otherwise. A non-JSON or non-envelope error body — e.g. edge/gateway HTML
 * ahead of Next — maps to `ApiError{code:"internal_error"}`.
 */
export async function apiFetch<T = unknown>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }

  if (response.ok) {
    if (text !== "" && body === undefined) {
      // 2xx with an unparseable body is a contract violation, not data.
      logErrorCode(
        "internal_error",
        `${response.status} ${stripQuery(response.url)} (unparseable 2xx body)`,
      );
      throw new ApiError({ status: response.status, code: "internal_error" });
    }
    return body as T;
  }

  throw toApiError(response, body);
}

/** Map a failed response + its parsed body (if any) to an `ApiError`. */
function toApiError(response: Response, body: unknown): ApiError {
  const envelope = (typeof body === "object" && body !== null ? body : {}) as ApiErrorEnvelope;
  const rawCode = typeof envelope.error === "string" ? envelope.error : undefined;
  const code: ErrorCode = isErrorCode(rawCode) ? rawCode : "internal_error";
  const serverMessage = typeof envelope.message === "string" ? envelope.message : undefined;
  const requestId =
    typeof envelope.request_id === "string"
      ? envelope.request_id
      : (response.headers.get("x-request-id") ?? undefined);

  if (body === undefined || !isErrorCode(rawCode) || serverMessage !== undefined) {
    logErrorCode(
      code,
      `${response.status} ${stripQuery(response.url)}` +
        (requestId !== undefined ? ` request_id=${requestId}` : "") +
        (serverMessage !== undefined ? ` message=${serverMessage}` : ""),
    );
  }

  return new ApiError({
    status: response.status,
    code,
    details: mergeDetails(envelope),
    requestId,
    serverMessage,
    retryAfterMs:
      response.status === 429 ? parseRetryAfterMs(response.headers.get("Retry-After")) : undefined,
  });
}

/**
 * Root-namespace translator — `useTranslations()` called without a scope.
 * (`useTranslations<never>` pins the type parameter: bare `typeof
 * useTranslations` resolves it to the union of all namespaces, which types
 * keys relative to a namespace instead of as full paths.) Scoped translators
 * cannot resolve the table's full key paths; omit `t` instead of passing one.
 */
export type ApiErrorTranslator = ReturnType<typeof useTranslations<never>>;

/**
 * `error` code → message key (spec 0011 D9). Only codes with dedicated,
 * accurate copy map here; everything else renders the caller's localized
 * fallback. Keys are root-namespace paths.
 */
const API_ERROR_I18N_KEYS: Partial<Record<ErrorCode, Parameters<ApiErrorTranslator>[0]>> = {
  handle_taken: "profile.identity_error_handle_taken",
  handle_change_too_soon: "profile.identity_error_handle_too_soon",
  invalid_handle: "profile.identity_error_invalid_handle",
  self_like_forbidden: "discovery.like_self",
};

/**
 * Resolve an API failure to a localized string (spec 0011 D9 — replaces
 * `responseMessage`/`userFacingMessage`).
 *
 * Accepts an `ApiError`, a parsed error envelope (`{error}`), or a plain
 * `Error` whose message is a machine code. A code with a table entry renders
 * its catalog copy; anything else renders `fallback`. Server `message` prose
 * and unrecognized text are logged, never rendered — a zh surface can never
 * show English server prose.
 */
export function apiErrorMessage(
  error: unknown,
  fallback: string,
  t?: ApiErrorTranslator,
): string {
  const code = errorCodeOf(error);

  if (typeof code === "string" && isErrorCode(code)) {
    const key = API_ERROR_I18N_KEYS[code];
    if (key !== undefined && t !== undefined && t.has(key)) return t(key);
    // Registered code without dedicated copy: the caller's fallback is the
    // copy. The withheld code is still logged for triage — an ApiError's
    // serverMessage/requestId already rode the apiFetch log line.
    logErrorCode(code, "apiErrorMessage fallback");
    return fallback;
  }

  const withheld =
    typeof code === "string" && code !== ""
      ? code
      : error instanceof Error && error.message !== ""
        ? error.message
        : undefined;
  if (withheld !== undefined) logErrorCode(withheld, "apiErrorMessage fallback");
  return fallback;
}

/**
 * Extract the machine code a failure carries: `ApiError.code`, a code-shaped
 * `Error.message`, or an envelope's `error` field. Returns the raw value —
 * registered or not — so the caller can log unregistered codes.
 */
function errorCodeOf(error: unknown): unknown {
  if (error instanceof ApiError) return error.code;
  if (error instanceof Error) {
    return ERROR_CODE_PATTERN.test(error.message) && isErrorCode(error.message)
      ? error.message
      : undefined;
  }
  if (typeof error === "object" && error !== null && "error" in error) {
    return (error as { error: unknown }).error;
  }
  return undefined;
}
