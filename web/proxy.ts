import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Session-refresh proxy (spec 0001, 0004).
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`. Runs on every
 * non-asset request, refreshes Supabase SSR cookies, and forwards the refreshed
 * cookies to both the request and the response. It never blocks public routes;
 * route handlers call `getUser()` for their own auth decisions.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase is not configured (e.g. local one-off builds), fall through.
  if (!url || !anonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  // No cookies means no Supabase session to refresh; skip the network round-trip.
  if (request.cookies.getAll().length === 0) {
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

  // Refreshing the session mutates the cookie bag via `setAll` above.
  // If Supabase is unreachable, fall through with the original request so
  // public routes and the offline page do not 500.
  try {
    await supabase.auth.getUser();
  } catch (e) {
    console.error("proxy: session refresh failed", e);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/|serwist/|icons/|fonts/|manifest\\.webmanifest|favicon\\.ico|api/health(?:/.*)?|api/places(?:/.*)?).*)",
  ],
};
