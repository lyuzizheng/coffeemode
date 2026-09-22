import type { SessionUser } from "@/lib/auth/get-user";
import { refreshSessionAndVerify } from "@/lib/auth/proxy-session";
import { VERIFIED_USER_HEADER } from "@/lib/auth/verified-user";
import { NextRequest, NextResponse } from "next/server";
import { CAFE_SHELL_BYPASS_CACHE_CONTROL } from "@/lib/cache-policy";
import { cafeExists } from "@/lib/db/cafes";
import { isValidUUID } from "@shared/uuid";
import { isErrorCode } from "@shared/errors";
import {
  REQUEST_ID_HEADER,
  emitAccessLine,
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

/** Internal request headers only this proxy may set (spoof strip). */
const INTERNAL_HEADERS = [GONE_HEADER, VERIFIED_USER_HEADER];

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
 * Clients must not be able to inject internal markers: strip inbound copies
 * so only this proxy's own values ever reach rendering.
 */
function sanitizedRequest(request: NextRequest): NextRequest {
  if (!INTERNAL_HEADERS.some((h) => request.headers.has(h))) return request;
  const headers = new Headers(request.headers);
  for (const h of INTERNAL_HEADERS) headers.delete(h);
  return new NextRequest(request, { headers });
}

// DG124: the /?cafe=[id] app entry is retired — stale shared links 308 to
// the canonical cafe URL, which hydrates into the map app itself. Lives in
// the proxy rather than next.config `redirects()` because config redirects
// forward the request query string, landing on /cafes/<id>?cafe=<id> — a
// non-canonical URL that would re-fire the redirect contract on every hit.
function legacyCafeRedirect(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname !== "/") return null;
  const cafe = request.nextUrl.searchParams.get("cafe");
  // isValidUUID (not a loose 36-char regex): a malformed id would 308 to a
  // guaranteed 404 — pointless redirect traffic.
  if (!cafe || !isValidUUID(cafe)) return null;
  return NextResponse.redirect(new URL(`/cafes/${cafe}`, request.url), 308);
}

async function handleProxy(request: NextRequest) {
  const req = sanitizedRequest(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request: req });
  let verifiedUser: SessionUser | null | undefined;
  let sessionRefreshed = false;

  if (url && anonKey && hasSupabaseSessionCookie(req)) {
    const isCafePage =
      (req.method === "GET" || req.method === "HEAD") &&
      CAFE_PAGE_PATH.test(req.nextUrl.pathname);
    ({ response, verifiedUser, sessionRefreshed } =
      await refreshSessionAndVerify(req, response, url, anonKey, isCafePage));
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
    (await isGoneCafePage(req, verifiedUser?.id ?? null))
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
 * Error code for the access line (spec 0011 D7): read the envelope's `error`
 * field on ≥400 JSON responses so per-code metrics don't need error-line
 * parsing. Clones the response — the body still reaches the client. Only
 * registered codes are logged; anything else is not our envelope.
 */
async function errorCodeOf(response: NextResponse): Promise<string | undefined> {
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
  const response = legacyCafeRedirect(request) ?? (await handleProxy(new NextRequest(request, { headers })));
  response.headers.set(REQUEST_ID_HEADER, requestId);
  const code = await errorCodeOf(response);
  emitAccessLine({
    type: "access",
    request_id: requestId,
    method: request.method,
    // BRAWUKA-282 P1-3: pathname only, never `search`. The matcher covers
    // `/auth/callback`, so logging `pathname + search` wrote the one-time
    // OAuth `code=` into stdout on every login (pre-exchange, still valid),
    // plus raw user query terms on `/api/search?q=…`.
    path: request.nextUrl.pathname,
    status: response.status,
    ...(code !== undefined ? { code } : {}),
    duration_ms: Date.now() - start,
  });
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
