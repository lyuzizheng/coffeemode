/**
 * Worker-side structured logger — the minimal JSON-line twin of
 * `web/lib/observability/server-log.ts` (spec 0011 D6/D7, BRAWUKA-539).
 *
 * One JSON line per error/warn, shaped to join the web access log on
 * `request_id`:
 *
 *   {"type":"error","request_id":"…","route":"GET /poi/:place_id","status":502,"code":"upstream_error","error":"…"}
 *
 * Rules (same as the web logger):
 * - Only `message` (+ first stack frame) is recorded, never whole objects,
 *   request bodies, or tokens — callers MUST NOT pass user content as `error`.
 * - Secret scrub: any `?key=`/`&key=` query value (the Google API key rides
 *   the geocode request URL) and `"key": "…"` JSON values are redacted
 *   before emitting, so a hostile Error message can never leak a key into
 *   Workers logs.
 * - Never throws: safe to call inside `catch` blocks.
 * - No dependencies: runs on Cloudflare Workers and under vitest/Node.
 *   (The web logger keeps `server-only`; this module stays importable.)
 */

import type { ErrorCode } from "./errors";
import { getRequestId } from "./request-id";

/** Cap on serialized non-Error payloads — they stay one line. */
const MAX_ERROR_CHARS = 1000;

export interface LogFields {
  /** Handler literal, e.g. `"GET /poi/:place_id"` — one literal per handler. */
  route: string;
  /** The caught value — Error, message string, or small internal object. */
  error: unknown;
  /** Request to resolve the id from. Preferred when in scope. */
  request?: { headers: Headers };
  /** Explicit id; wins over `request`. */
  requestId?: string | null;
  /** HTTP status about to be returned, when known. */
  status?: number;
  /** Registered error code being returned (emitted when status ≥ 400). */
  code?: ErrorCode;
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_CHARS
    ? value.slice(0, MAX_ERROR_CHARS) + "…"
    : value;
}

/**
 * Redact secret-shaped values before they reach a log line. The Google key
 * rides the geocode request URL (`?key=`), so any Error text built near an
 * upstream call can carry it — redact the value but keep the `?`/`&`
 * delimiter, so the line stays greppable and a `key=` search stays empty.
 */
function scrubSecrets(value: string): string {
  return value
    .replace(/([?&])key=[^&\s"'`\\]*/gi, "$1[redacted]")
    .replace(/"key"\s*:\s*"[^"]*"/gi, '"key":"[redacted]"');
}

function extractError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const lines = error.stack?.split("\n") ?? [];
    // lines[0] is "Error: <message>" (redundant); first frame carries signal.
    const frame = lines.length > 1 ? lines[1].trim() : undefined;
    return {
      message: truncate(scrubSecrets(error.message || error.name)),
      ...(frame ? { stack: truncate(scrubSecrets(frame)) } : {}),
    };
  }
  if (typeof error === "string") return { message: truncate(scrubSecrets(error)) };
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return { message: String(error) };
  }
  try {
    const json = JSON.stringify(error);
    return { message: truncate(scrubSecrets(json ?? String(error))) };
  } catch {
    // Benign: fallback for non-serializable objects (e.g. circular references).
    return { message: String(error) };
  }
}

function emitLine(type: "error" | "warn", fields: LogFields): void {
  const { message, stack } = extractError(fields.error);
  const requestId = fields.requestId ?? (fields.request ? getRequestId(fields.request) : null);
  const sink = type === "warn" ? console.warn : console.error;
  sink(
    JSON.stringify({
      type,
      request_id: requestId,
      route: fields.route,
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.code !== undefined && (fields.status === undefined || fields.status >= 400)
        ? { code: fields.code }
        : {}),
      error: message,
      ...(stack ? { stack } : {}),
    }),
  );
}

/** Emit one JSON error line. Never throws. */
export function logError(fields: LogFields): void {
  emitLine("error", fields);
}

/**
 * Emit one JSON warn line. Same shape as `logError` with `type: "warn"` —
 * for auth rejections (bad token, unconfigured service token) that should
 * be greppable without paging on them. Never throws.
 */
export function logWarn(fields: LogFields): void {
  emitLine("warn", fields);
}
