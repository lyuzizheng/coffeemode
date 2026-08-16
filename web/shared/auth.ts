/**
 * Shared auth primitives for the worker services (poi-service,
 * image-service): constant-time token comparison, Bearer extraction, and
 * the standard JSON error envelope. Keep this file free of runtime
 * dependencies so it runs on Cloudflare Workers and under vitest/Node.
 */

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
