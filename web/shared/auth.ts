/**
 * Shared auth primitives for the worker services (poi-service,
 * image-service): constant-time token comparison, Bearer extraction, and
 * the standard JSON error envelope. Keep this file free of runtime
 * dependencies so it runs on Cloudflare Workers and under vitest/Node.
 */

/**
 * Constant-time token compare. Uses Cloudflare Workers'
 * `SubtleCrypto.timingSafeEqual` extension when available, otherwise a
 * pure-JS fallback (Node/vitest).
 *
 * The first argument is the attacker-provided token; the second is the
 * expected secret. On length mismatch we compare the expected secret with
 * itself so the comparison time depends on the secret length, not the
 * attacker input.
 */
export function safeEqual(provided: string, expected: string): boolean {
  const P = new TextEncoder().encode(provided);
  const E = new TextEncoder().encode(expected);
  const sameLength = P.byteLength === E.byteLength;

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

/** Shared JSON response helper — identical envelope on both services. */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Standard auth-failure envelope, shared by both services. */
export function unauthorized(): Response {
  return json({ error: "unauthorized", message: "missing or invalid service token" }, 401);
}

/** Standard catch-all failure envelope, shared by both services. */
export function internalError(): Response {
  return json({ error: "internal_error", message: "internal server error" }, 500);
}
