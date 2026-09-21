/**
 * Shared auth primitives for the worker services (poi-service,
 * image-service): constant-time token comparison, Bearer extraction, and
 * the standard JSON error envelope. Keep this file free of runtime
 * dependencies so it runs on Cloudflare Workers and under vitest/Node.
 */

import type { ErrorCode } from "./errors";
import { getRequestId, REQUEST_ID_HEADER } from "./request-id";

/**
 * Constant-time token compare. Both inputs are hashed with SHA-256 and the
 * fixed-length digests are compared, so the work done never depends on the
 * length (or content) of the attacker-provided token, and never reveals the
 * length of the expected secret. Uses Cloudflare Workers'
 * `SubtleCrypto.timingSafeEqual` extension when available, otherwise a
 * pure-JS fallback (Node/vitest).
 *
 * The first argument is the attacker-provided token; the second is the
 * expected secret.
 */
export async function safeEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const aBuf = new Uint8Array(a);
  const bBuf = new Uint8Array(b);

  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(aBuf, bBuf);
  }

  // Pure-JS fallback for test environments without timingSafeEqual.
  // Digests are always 32 bytes, so the loop length is input-independent.
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) diff |= aBuf[i] ^ bBuf[i];
  return diff === 0;
}

/**
 * Extract the token from a service-specific header (`x-poi-service-token`,
 * `x-image-service-token`) or an `Authorization: Bearer` header. The Bearer
 * scheme is case-insensitive per RFC 6750.
 */
export function extractBearer(request: Request, headerName: string): string | null {
  const header = request.headers.get(headerName);
  if (header) return header;

  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "");
  return null;
}

/**
 * Error envelope shape (spec 0011 D2): `error` is a registered machine code,
 * `request_id` correlates the response with the request's `x-request-id`.
 * Extra fields (`entries`, …) are allowed beside the envelope keys.
 */
interface ErrorEnvelope {
  error: ErrorCode;
  message?: string;
  request_id?: string;
  [key: string]: unknown;
}

/**
 * Shared JSON response helper — identical envelope on both services.
 *
 * Error bodies (`{error: <code>, ...}`) are typed to the registry: an
 * unregistered code fails typecheck. Every response carries the
 * `x-request-id` header — the inbound value when `request` is passed, else
 * a fresh UUID — and error bodies also embed it as `request_id`.
 *
 * Second argument is the HTTP status or the request (`json(data, request)`
 * for a 200 that still echoes the id).
 */
export function json(
  data: ErrorEnvelope,
  statusOrRequest?: number | { headers: Headers },
  request?: { headers: Headers },
): Response;
export function json<T>(
  data: T extends { error: unknown } ? never : T,
  statusOrRequest?: number | { headers: Headers },
  request?: { headers: Headers },
): Response;
export function json(
  data: unknown,
  statusOrRequest?: number | { headers: Headers },
  request?: { headers: Headers },
): Response {
  const status = typeof statusOrRequest === "number" ? statusOrRequest : 200;
  const req = typeof statusOrRequest === "number" ? request : statusOrRequest;
  const requestId = getRequestId(req);
  const isError =
    typeof data === "object" && data !== null && "error" in data;
  const body = isError
    ? { ...(data as Record<string, unknown>), request_id: requestId }
    : data;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}

/** Standard auth-failure envelope, shared by both services. */
export function unauthorized(request?: { headers: Headers }): Response {
  return json(
    { error: "unauthorized", message: "missing or invalid service token" },
    401,
    request,
  );
}

/** Standard catch-all failure envelope, shared by both services. */
export function internalError(request?: { headers: Headers }): Response {
  return json(
    { error: "internal_error", message: "internal server error" },
    500,
    request,
  );
}
