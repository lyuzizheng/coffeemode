import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { CAFE_SHELL_BYPASS_CACHE_CONTROL } from "@/lib/cache-policy";
import { cafeExists } from "@/lib/db/cafes";
import {
  REQUEST_ID_HEADER,
  getRequestId,
  logError,
} from "@/lib/observability/server-log";

/**
 * Session-refresh proxy (spec 0001, 0004).
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`. Runs on
 * matched non-asset requests, refreshes Supabase SSR cookies only when a
 * session cookie is present, and forwards refreshed cookies to both the
 * request and the response. It never blocks public routes; route handlers
 * call `getUser()` for their own auth decisions.
 *
 * It also commits the gone-cafe 404 status (DG19): the cafe page is async,
 * so the root loading boundary streams its shell with a 200 before a
 * page-level notFound() can run. Existence is probed here — PK lookup only,
 * never content — and missing ids are rewritten to a sync page that throws
 * notFound(), which flushes unstreamed and keeps the real 404 status.
 */

const CAFE_PAGE_PATH = /^\/cafes\/([^/]+)$/;

/** Header the proxy uses to hand the attempted id to the global 404. */
const GONE_HEADER = "x-gone-cafe-id";

async function isGoneCafePage(
  request: NextRequest,
  userId: string | null,
): Promise<boolean> {
  const match = CAFE_PAGE_PATH.exec(request.nextUrl.pathname);
  if (!match) return false;
  try {
    return !(await cafeExists(match[1], userId));
  } catch (err) {
    // DB unreachable: fail open. The page handles the error surface; a
    // degraded soft-404 beats turning every deep link into a 500.
    logError({ route: "proxy gone-cafe check", request, error: err });
    return false;
  }
}

/**
 * Clients must not be able to inject the internal marker: strip any inbound
 * copy so only this proxy's rewrite ever sets it.
 */
function sanitizedRequest(request: NextRequest): NextRequest {
  if (!request.headers.has(GONE_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(GONE_HEADER);
  return new NextRequest(request, { headers });
}
async function handleProxy(request: NextRequest) {
  const req = sanitizedRequest(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request: req });
  let userId: string | null = null;
  let sessionRefreshed = false;

  // Session refresh runs FIRST, on the single client that owns setAll.
  // A second client calling getUser() here would refresh an expired session
  // and silently drop the rotated refresh token (no setAll → ssr discards
  // the write); this client's later getSession() then fails on the consumed
  // token and emits session-removal cookies — a forced logout. getSession()
  // only decodes the local session without validating the JWT, so userId
  // stays null until verified below.
  if (url && anonKey && hasSupabaseSessionCookie(req)) {
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

    // Verify the user for the gone-cafe visibility check on the SAME client
    // (it owns setAll, so a refresh here is persisted). getSession() above
    // only decodes the session without validating the JWT — passing its
    // user id to cafeExists() would let a self-signed sb-*-auth-token cookie
    // impersonate any user for the private-cafe existence probe. Scoped to
    // cafe GET/HEAD so the cost matches the old baseline (one getUser() per
    // cafe page view, none elsewhere).
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      CAFE_PAGE_PATH.test(req.nextUrl.pathname)
    ) {
      try {
        const { data } = await supabase.auth.getUser();
        userId = data.user?.id ?? null;
      } catch {
        // Benign: treat an unverifiable session as anonymous; the page's own
        // getUser() renders the final auth surface.
        userId = null;
      }
    }
  }

  // Gone-cafe deep links get a real 404 (DG19). The cafe page is async, and
  // the root loading boundary streams a matched route's shell with a 200
  // before any page-level notFound() can run — so the 404 must be decided
  // here, before routing. The rewrite target matches NO route: the global
  // not-found surface commits the 404 status at routing time, and reads the
  // attempted id from x-gone-cafe-id to render the designed gone-cafe page
  // (with the DG111 recovery block). GET/HEAD only — no other method
  // targets the SSR page.
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (await isGoneCafePage(req, userId))
  ) {
    const id = CAFE_PAGE_PATH.exec(req.nextUrl.pathname)?.[1] ?? "";
    // req.headers already carries any refreshed session cookies (setAll
    // mutated req.cookies above), so the rewrite forwards them upstream.
    const headers = new Headers(req.headers);
    headers.set(GONE_HEADER, id);
    const gone = NextResponse.rewrite(new URL("/__gone-cafe", req.url), {
      request: { headers },
    });
    // BRAWUKA-315 P1: the session refresh above wrote rotated cookies onto
    // `response` — but this branch returns a NEW rewrite response, discarding
    // it. The server-side refresh token is already consumed, so a dropped
    // Set-Cookie means the next request refreshes on the spent token and
    // forces a logout. Forward the refreshed cookies onto the rewrite.
    for (const c of response.cookies.getAll()) {
      gone.cookies.set(c);
    }
    // BRAWUKA-184: a 404 MUST NOT sit in shared cache (a recreated cafe
    // would stay gone for up to s-maxage). The static public header from
    // next.config matches this path, so stamp the bypass here.
    gone.headers.set("Cache-Control", CAFE_SHELL_BYPASS_CACHE_CONTROL);
    return gone;
  }

  // BRAWUKA-184: a response carrying a refreshed session (Set-Cookie) MUST
  // NOT sit in shared cache — otherwise one user's session cookie is served
  // cross-user. Anonymous pass-through (no Set-Cookie) keeps the static
  // public header; sb-* request cookies without a refresh are handled by the
  // edge bypass rule (deploy/dokploy/cache-rules.json).
  if (sessionRefreshed) {
    response.headers.set("Cache-Control", CAFE_SHELL_BYPASS_CACHE_CONTROL);
  }

  return response;
}

/**
 * Proxy entry (BRAWUKA-167): access log wrapper around the session/gone-cafe
 * proxy. Observability only — one JSON line per request
 * (method/path/status/duration_ms). Never blocks or rewrites.
 */
export async function proxy(request: NextRequest) {
  const start = Date.now();
  // BRAWUKA-168: one id per request. Reuse a valid inbound x-request-id so
  // upstream callers can correlate; otherwise generate. Forwarded on the
  // request headers so route handlers read the same value via getRequestId();
  // echoed back so clients can quote it in bug reports.
  const requestId = getRequestId(request);
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = await handleProxy(new NextRequest(request, { headers }));
  response.headers.set(REQUEST_ID_HEADER, requestId);
  console.log(
    JSON.stringify({
      type: "access",
      request_id: requestId,
      method: request.method,
      // BRAWUKA-282 P1-3: pathname only, never `search`. The matcher covers
      // `/auth/callback`, so logging `pathname + search` wrote the one-time
      // OAuth `code=` into stdout on every login (pre-exchange, still valid),
      // plus raw user query terms on `/api/search?q=…`.
      path: request.nextUrl.pathname,
      status: response.status,
      duration_ms: Date.now() - start,
    }),
  );
  return response;
}

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) =>
    name === "sb-access-token" ||
    name === "sb-refresh-token" ||
    /^sb-.+-auth-token$/.test(name) ||
    /^sb-.+-refresh-token$/.test(name)
  );
}

export const config = {
  matcher: [
    "/((?!_next/|serwist/|icons/|fonts/|manifest\\.webmanifest|favicon\\.ico|api/health(?:/.*)?|api/heartbeat(?:/.*)?|api/config(?:/.*)?).*)",
  ],
};
