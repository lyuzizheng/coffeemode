import "server-only";

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

export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cap on serialized non-Error payloads — they stay one line. */
const MAX_ERROR_CHARS = 1000;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Request-id for a server handler. Reuses a valid inbound `x-request-id`
 * (set by the proxy, which generates one per request) so access and error
 * lines correlate; generates a fresh id when missing/invalid — e.g. the
 * `/api/health` route the proxy matcher skips, or direct handler calls.
 */
export function getRequestId(request: { headers: Headers }): string {
  const inbound = request.headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(inbound) ? inbound : crypto.randomUUID();
}

export interface ServerErrorFields {
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
    return { message: String(error) };
  }
}

/** Emit one JSON error line. Never throws. */
export function logError(fields: ServerErrorFields): void {
  const { message, stack } = extractError(fields.error);
  const requestId = fields.requestId ?? (fields.request ? getRequestId(fields.request) : null);
  console.error(
    JSON.stringify({
      type: "error",
      request_id: requestId,
      route: fields.route,
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      error: message,
      ...(stack ? { stack } : {}),
    }),
  );
}
