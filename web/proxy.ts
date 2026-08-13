import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Session-refresh proxy (spec 0001, 0004).
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`. Runs on
 * matched non-asset requests, refreshes Supabase SSR cookies only when a
 * session cookie is present, and forwards refreshed cookies to both the
 * request and the response. It never blocks public routes; route handlers
 * call `getUser()` for their own auth decisions.
 */
export async function proxy(request: NextRequest) {
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
