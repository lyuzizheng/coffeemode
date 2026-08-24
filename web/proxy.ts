import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { cafeExists } from "@/lib/db/cafes";

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

async function isGoneCafePage(request: NextRequest): Promise<boolean> {
  const match = CAFE_PAGE_PATH.exec(request.nextUrl.pathname);
  if (!match) return false;
  try {
    return !(await cafeExists(match[1]));
  } catch (err) {
    // DB unreachable: fail open. The page handles the error surface; a
    // degraded soft-404 beats turning every deep link into a 500.
    console.error("proxy: cafe existence check failed", err);
    return false;
  }
}

export async function proxy(request: NextRequest) {
  // Gone-cafe deep links get a real 404 (DG19). The cafe page is async, and
  // the root loading boundary streams a matched route's shell with a 200
  // before any page-level notFound() can run — so the 404 must be decided
  // here, before routing. The rewrite target matches NO route: the global
  // not-found surface commits the 404 status at routing time, and reads the
  // attempted id from x-gone-cafe-id to render the designed gone-cafe page
  // (with the DG111 recovery block). GET/HEAD only — no other method
  // targets the SSR page.
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (await isGoneCafePage(request))
  ) {
    const id = CAFE_PAGE_PATH.exec(request.nextUrl.pathname)?.[1] ?? "";
    const headers = new Headers(request.headers);
    headers.set("x-gone-cafe-id", id);
    return NextResponse.rewrite(new URL("/__gone-cafe", request.url), {
      request: { headers },
    });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase is not configured (e.g. local one-off builds), fall through.
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  // No Supabase session cookies means no refresh work; skip the network
  // round-trip entirely. Analytics / consent / A/B cookies do not count.
  if (!hasSupabaseSessionCookie(request)) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Forward refreshed cookies onto the request so route handlers see
        // the latest session, then mirror them (with serialize options) onto
        // the outgoing response.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getSession()` refreshes only when the access token is expired, and does
  // not force a network validation on every request like `getUser()` does.
  // If Supabase is unreachable, fall through so public routes and the
  // offline page do not 500.
  try {
    await supabase.auth.getSession();
  } catch (e) {
    console.error("proxy: session refresh failed", e);
  }

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
    "/((?!_next/|serwist/|icons/|fonts/|manifest\\.webmanifest|favicon\\.ico|api/health(?:/.*)?|api/places(?:/.*)?).*)",
  ],
};
