/**
 * Fake-JWT single source of truth (spec 0010 §3 G4).
 *
 * The deterministic unsigned JWT shape used by local auth fakes: fixed HS256
 * header, `{ sub, role: "authenticated", exp, ...extra }` payload, dummy
 * signature. Nothing verifies the signature.
 *
 * Consumed by:
 *   - `scripts/supabase-mock.mjs` (compose GoTrue stand-in — same process,
 *     relative import, zero dependencies so the `node:22-alpine` container
 *     needs no install step);
 *   - `web/tests/helpers/auth.ts` (typed test-helper surface — re-exports these
 *     functions; integration suites never touch the network).
 *
 * Change the shape here and both consumers follow. Do NOT fork this file.
 */

export function base64UrlEncode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}

export function fakeJwt(userId, extra = {}, expiresInSec = 3600) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + expiresInSec,
      ...extra,
    }),
  );
  const signature = base64UrlEncode("fake-signature");
  return `${header}.${payload}.${signature}`;
}

/**
 * Decode a fake JWT payload. Throws `Error("invalid JWT")` on a malformed
 * token (web/tests/helpers/auth.ts contract); callers that map failure to a
 * 401 (supabase-mock `/auth/v1/user`) catch and treat it as unauthorized.
 */
export function decodeFakeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid JWT");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}
