/**
 * API completion access line — the single observer at the response-producing
 * route boundary (BRAWUKA-729, spec 0011 D7).
 *
 * The proxy runs before routing, so its `NextResponse.next()` is always 200
 * and cannot report the route's real status. Every `apiRoute()` exit path —
 * origin/guard rejections, handler responses, and the catch-all — flows
 * through here instead, emitting one line per request with the produced
 * status, the envelope `code` on ≥400, and the full guard+handler elapsed
 * time. Guard rejections (401/403/429) already carry their envelope bodies,
 * so the error code reads straight off the response.
 *
 * Edge-safe by construction: no `node:` imports, no `server-only` guard, no
 * `lib/` imports — `proxy.ts` (edge runtime) and `lib/api/route.ts` share
 * this module. Logging policy: `path` is pathname-only, never `search`
 * (BRAWUKA-282 P1-3: query strings may carry OAuth codes and user terms);
 * only registered envelope codes are logged, never body content.
 */

import { isErrorCode } from "./errors";
import { emitAccessLine } from "./log";

/**
 * Read the envelope's `error` field on ≥400 JSON responses so per-code
 * metrics don't need error-line parsing. Clones the response — the body
 * still reaches the client. Non-JSON bodies and unregistered codes yield
 * nothing. Shared by the route completion line and the proxy's non-API
 * line so the extraction stays one implementation.
 */
export async function accessErrorCode(
  response: Response,
): Promise<string | undefined> {
  if (response.status < 400) return undefined;
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return undefined;
  }
  const body: unknown = await response.clone().json().catch(() => null);
  const code =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).error
      : undefined;
  return isErrorCode(code) ? code : undefined;
}

interface ApiAccessLineSource {
  request: Request;
  requestId: string;
  route: string;
  response: Response;
  startedAt: number;
}

/**
 * Emit the completion access line for a finished API request. Never throws:
 * observability must not break the response it describes.
 */
export async function emitApiAccessLine(
  source: ApiAccessLineSource,
): Promise<void> {
  let path: string;
  try {
    path = new URL(source.request.url).pathname;
  } catch {
    path = source.route;
  }
  const code = await accessErrorCode(source.response);
  emitAccessLine({
    type: "access",
    request_id: source.requestId,
    route: source.route,
    method: source.request.method,
    path,
    status: source.response.status,
    ...(code !== undefined ? { code } : {}),
    duration_ms: Date.now() - source.startedAt,
  });
}
