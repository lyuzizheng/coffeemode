/**
 * Request authentication + shared JSON response helpers.
 * Mirrors image-service semantics: case-insensitive `Bearer` scheme
 * (RFC 6750) or a service-specific header, timing-safe token compare,
 * fail-closed when the expected token is unset, and one error envelope
 * shape `{ error: code, message?: string }` on both services.
 */

import type { Env } from "./types";

/**
 * Constant-time token compare. Uses Cloudflare Workers' crypto.subtle.timingSafeEqual
 * extension when available, otherwise a pure-JS fallback for Node/vitest.
 *
 * The first argument is the attacker-provided token; the second is the
 * expected secret. On length mismatch we compare the expected secret with itself
 * so the comparison time depends on the secret length, not the attacker input.
 */
export function safeEqual(provided: string, expected: string): boolean {
  const P = new TextEncoder().encode(provided);
  const E = new TextEncoder().encode(expected);
  const sameLength = P.byteLength === E.byteLength;

  // Cloudflare Workers exposes SubtleCrypto.timingSafeEqual as a non-standard extension.
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    // Compare expected with itself on length mismatch so the timing path does
    // not depend on the attacker-provided length.
    const aBuf = E;
    const bBuf = sameLength ? P : E;
    const equal = subtle.timingSafeEqual(aBuf, bBuf);
    return sameLength ? equal : !equal;
  }

  // Pure-JS fallback for test environments without timingSafeEqual.
  const aBuf = E;
  const bBuf = sameLength ? P : E;
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) diff |= aBuf[i] ^ bBuf[i];
  const equalContent = diff === 0;
  return sameLength ? equalContent : !equalContent;
}

/** Extract the token from the service header or an Authorization: Bearer header.
 *  The Bearer scheme is case-insensitive per RFC 6750. */
export function bearer(request: Request): string | null {
  const serviceToken = request.headers.get("x-poi-service-token");
  if (serviceToken) return serviceToken;

  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "");
  return null;
}

export async function authorized(request: Request, env: Env): Promise<boolean> {
  const token = bearer(request);
  if (!token || !env.POI_SERVICE_TOKEN) return false;
  return safeEqual(token, env.POI_SERVICE_TOKEN);
}

// --- shared response helpers (identical envelope on both services) ---

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Standard auth-failure envelope, shared with image-service. */
export function unauthorized(): Response {
  return json({ error: "unauthorized", message: "missing or invalid service token" }, 401);
}

/** Standard catch-all failure envelope, shared with image-service. */
export function internalError(): Response {
  return json({ error: "internal_error", message: "internal server error" }, 500);
}
