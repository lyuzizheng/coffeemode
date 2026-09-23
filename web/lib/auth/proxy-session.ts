import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { SessionUser } from "./get-user";
import { VERIFIED_USER_HEADER, encodeVerifiedUser } from "./verified-user";
import { logError } from "@/lib/observability/server-log";

/**
 * Proxy-side session refresh + user verification (split from proxy.ts for the
 * file budget). Imported by the proxy bundle — keep it free of `server-only`
 * and `next/headers`.
 */

export interface SessionRefreshResult {
  response: NextResponse;
  /** Tri-state: undefined = not verified (non-cafe route, no session cookie,
   * or getUser threw — the page retries its own getUser); null = verified
   * anonymous; SessionUser = verified identity handed to the page. */
  verifiedUser: SessionUser | null | undefined;
  sessionRefreshed: boolean;
}

/**
 * Refresh the Supabase session on the single client that owns setAll, then —
 * when `verifyForCafePage` (cafe GET/HEAD only) — verify the user for the
 * gone-cafe visibility probe and hand the verified identity to the page on
 * x-verified-user (BRAWUKA-644).
 */
export async function refreshSessionAndVerify(
  req: NextRequest,
  response: NextResponse,
  url: string,
  anonKey: string,
  verifyForCafePage: boolean,
): Promise<SessionRefreshResult> {
  let verifiedUser: SessionUser | null | undefined;
  let sessionRefreshed = false;

  // Session refresh runs FIRST, on the single client that owns setAll.
  // A second client calling getUser() here would refresh an expired session
  // and silently drop the rotated refresh token (no setAll → ssr discards
  // the write); this client's later getSession() then fails on the consumed
  // token and emits session-removal cookies — a forced logout. getSession()
  // only decodes the local session without validating the JWT, so the user
  // stays unverified until getUser() runs below.
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Forward refreshed cookies onto the request so route handlers see
        // the latest session, then mirror them (with serialize options)
        // onto the outgoing response.
        if (cookiesToSet.length > 0) sessionRefreshed = true;
        for (const { name, value } of cookiesToSet) {
          req.cookies.set(name, value);
        }

        response = NextResponse.next({ request: req });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getSession()` refreshes only when the access token is expired, and
  // does not force a network validation on every request like `getUser()`
  // does. If Supabase is unreachable, fall through so public routes and
  // the offline page do not 500.
  try {
    await supabase.auth.getSession();
  } catch (e) {
    logError({ route: "proxy session refresh", request: req, error: e });
  }

  // Verify the user on the SAME client (it owns setAll, so a refresh here
  // is persisted). getSession() above only decodes the session without
  // validating the JWT — forwarding its unverified user id would let a
  // self-signed sb-*-auth-token cookie impersonate any user on the cafe
  // page (BRAWUKA-315). Scoped to cafe GET/HEAD so the cost matches the
  // baseline (one getUser() per cafe page view, none elsewhere).
  //
  // BRAWUKA-644: the verified result is forwarded to the page on
  // x-verified-user — the page's loadMapSession() reuses it instead of
  // running a second getUser() network validation for the same request.
  if (verifyForCafePage) {
    try {
      const { data } = await supabase.auth.getUser();
      verifiedUser = data.user;
    } catch {
      // Benign: leave verifiedUser undefined — no header is written, so
      // the page's own getUser() retries and renders the final auth surface.
    }
  }

  // Hand the verified identity to the page (BRAWUKA-644).
  if (verifiedUser !== undefined) {
    response = forwardVerifiedUser(req, response, verifiedUser);
  }

  return { response, verifiedUser, sessionRefreshed };
}

/**
 * Stamp x-verified-user onto the request and rebuild the pass-through
 * response so Next.js forwards it upstream. The header must land on the
 * request BEFORE the response that forwards it is built — a refresh in
 * setAll already replaced `response`, so the rotated cookies are carried
 * over explicitly (same rule as the gone-cafe rewrite in proxy.ts).
 */
function forwardVerifiedUser(
  req: NextRequest,
  response: NextResponse,
  user: SessionUser | null,
): NextResponse {
  req.headers.set(VERIFIED_USER_HEADER, encodeVerifiedUser(user));
  const forwarded = NextResponse.next({ request: req });
  for (const c of response.cookies.getAll()) {
    forwarded.cookies.set(c);
  }
  return forwarded;
}
