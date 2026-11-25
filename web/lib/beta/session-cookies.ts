import type { NextResponse } from "next/server";

/**
 * Session cookies as `@supabase/ssr` names them: the bare/chunked auth-token
 * pair, plus the legacy hand-set names. Opaque `sb-*-auth-token` values are
 * chunked above ~3.2 KiB, so every `.<n>` chunk is matched too.
 *
 * Shared by the page gate and the API gate (BRAWUKA-970): both refuse a
 * session the app has already rejected, and both must end it on the same
 * response — the browser must not keep presenting a cookie that was denied.
 */
export const SESSION_COOKIE = /^(?:sb-.+-(?:auth|refresh)-token(?:\.\d+)?|sb-(?:access|refresh)-token)$/;

/**
 * Expire every session cookie the request presented on `response`.
 *
 * Reads the `Cookie` header rather than a Next.js request type: the page gate
 * holds a `NextRequest` and `guard()` a plain `Request`, and both need the
 * same list. The request itself keeps its cookies for this response's own
 * render; only the browser's copy is cleared.
 */
export function expireSessionCookies(request: Request, response: NextResponse): void {
  const header = request.headers.get("cookie");
  if (!header) return;
  for (const pair of header.split(";")) {
    const name = pair.slice(0, pair.indexOf("=")).trim();
    if (name === "" || !SESSION_COOKIE.test(name)) continue;
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}
