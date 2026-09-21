import "server-only";

import type { ErrorCode } from "@shared/errors";
import { getRequestId } from "@shared/request-id";

/**
 * Minimal server-side structured logger + request-id (BRAWUKA-168, ADR-0004).
 *
 * One JSON line per error, shaped to join with the proxy access log
 * (`type: "access"`) on `request_id`:
 *
 *   {"type":"error","request_id":"…","route":"GET /api/cafes","error":"…"}
 *
 * Rules:
 * - Only `message` (+ first stack frame) is recorded, never the whole
 *   error object or request bodies — callers MUST NOT pass user content
 *   (notes, bodies, tokens) as `error`.
 * - No dependencies, never throws: safe to call inside `catch` blocks.
 * - No AsyncLocalStorage: the ~30 callsites pass `requestId` explicitly
 *   (boring, greppable). Lib code without request context omits it
 *   (`request_id: null`).
 */

// Request-id primitives live in `web/shared/request-id.ts` so the workers
// share them; re-exported here to keep this module's public API stable.
export { getRequestId, isValidRequestId, REQUEST_ID_HEADER } from "@shared/request-id";

/** Cap on serialized non-Error payloads — they stay one line. */
const MAX_ERROR_CHARS = 1000;
interface ServerErrorFields {
  /** Handler literal, e.g. `"GET /api/cafes"`. Prefer `gate.route` — one literal per handler. */
  route: string;
  /** The caught value — Error, message string, or small internal object. */
  error: unknown;
  /** Request to resolve the id from. Preferred over `requestId` when in scope. */
  request?: { headers: Headers };
  /** Explicit id; wins over `request`. Kept for lib code without request context. */
  requestId?: string | null;
  /** HTTP status about to be returned, when known. */
  status?: number;
  /**
   * Registered error code being returned. Emitted on the line when the
   * status is ≥ 400 (or unknown) — enables per-code metrics without
   * parsing error text (spec 0011 D7).
   */
  code?: ErrorCode;
}

function truncate(value: string): string {
  return value.length > MAX_ERROR_CHARS
    ? value.slice(0, MAX_ERROR_CHARS) + "…"
    : value;
}

function extractError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const lines = error.stack?.split("\n") ?? [];
    // lines[0] is "Error: <message>" (redundant); first frame carries signal.
    const frame = lines.length > 1 ? lines[1].trim() : undefined;
    return {
      message: truncate(error.message || error.name),
      ...(frame ? { stack: truncate(frame) } : {}),
    };
  }
  if (typeof error === "string") return { message: truncate(error) };
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return { message: String(error) };
  }
  try {
    const json = JSON.stringify(error);
    return { message: truncate(json ?? String(error)) };
  } catch {
    // Benign: fallback for non-serializable objects (e.g. circular references).
    return { message: String(error) };
  }
}

function emitLine(type: "error" | "warn", fields: ServerErrorFields): void {
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
export function logError(fields: ServerErrorFields): void {
  emitLine("error", fields);
}

/**
 * Emit one JSON warn line (spec 0011 D7). Same shape as `logError` with
 * `type: "warn"` — for security-relevant 4xx (`forbidden_origin`,
 * `bot_verification_failed`, repeated `unauthorized`) that should be
 * greppable without paging on them. Never throws.
 */
export function logWarn(fields: ServerErrorFields): void {
  emitLine("warn", fields);
}
