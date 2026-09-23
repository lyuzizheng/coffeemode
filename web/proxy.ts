import { refreshSessionAndVerify } from "@/lib/auth/proxy-session";
import { VERIFIED_USER_HEADER } from "@/lib/auth/verified-user";
import { NextRequest, NextResponse } from "next/server";
import { redirectToPath } from "@/lib/security/origin";
import { CAFE_SHELL_BYPASS_CACHE_CONTROL } from "@/lib/cache-policy";
import { isValidUUID } from "@shared/uuid";
import { isErrorCode } from "@shared/errors";
import {
  REQUEST_ID_HEADER,
  emitAccessLine,
  getRequestId,
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
 * The gone-cafe 404 (DG19) is NOT decided here (BRAWUKA-658): the page's
 * generateMetadata() calls notFound(), which commits the real 404 status
 * because no loading boundary wraps /cafes/[id] — the map-home skeleton
 * lives in app/(home)/loading.tsx, scoped to `/` by the route group. A
 * proxy-side existence probe would duplicate the page's getCafe query on
 * every GET.
 */

const CAFE_PAGE_PATH = /^\/cafes\/([^/]+)$/;

/** Internal request headers only this proxy may set (spoof strip). */
const INTERNAL_HEADERS = [VERIFIED_USER_HEADER];

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
  // redirectToPath, not request.url: behind the staging proxy request.url's
  // origin is the internal listener (BRAWUKA-558).
  return redirectToPath(request, `/cafes/${cafe}`, 308);
}

async function handleProxy(request: NextRequest) {
  const req = sanitizedRequest(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request: req });
  let sessionRefreshed = false;

  if (url && anonKey && hasSupabaseSessionCookie(req)) {
    const isCafePage =
      (req.method === "GET" || req.method === "HEAD") &&
      CAFE_PAGE_PATH.test(req.nextUrl.pathname);
    ({ response, sessionRefreshed } =
      await refreshSessionAndVerify(req, response, url, anonKey, isCafePage));
  }

  // DG19 note: gone-cafe deep links are NOT rewritten here anymore
  // (BRAWUKA-658). The page's generateMetadata() commits the real 404 via
  // notFound() — possible because no loading boundary wraps /cafes/[id]
  // (the map skeleton moved into app/(home)/). The segment not-found.tsx
  // renders the designed gone-cafe surface and the DG111 recovery block
  // reads the attempted id from route params.
  //
  // A 404 from that path carries the static s-maxage header from
  // next.config — inert because the edge rule bypasses every non-200
  // (deploy/dokploy/cache-rules.json onStatusesOtherThan: [200]).

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
