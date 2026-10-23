import { logError } from "@/lib/observability/server-log";
import {
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
} from "@/lib/auth/supabase-env";
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for route handlers and Server Components.
 *
 * Supabase hosts auth and app data (spec 0010 §2): sessions and OAuth here.
 * All data access goes through Postgres via route handlers that verify the
 * Supabase session first.
 *
 * Throws at request time (not import time) when env is missing, so builds
 * and CI run without credentials configured.
 */
export async function createSupabaseServerClient() {
  const url = resolveSupabaseUrl();
  const publishableKey = resolveSupabasePublishableKey();
  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (legacy NEXT_PUBLIC_SUPABASE_ANON_KEY still accepted; see web/.env.example).",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch (e) {
          // Setting cookies is not allowed in Server Components (they are read-only
          // there). That case is expected and safe to ignore; session refresh also
          // runs in route handlers. Other errors (invalid name, oversized value,
          // full cookie jar) are real problems and should surface.
          if (isReadOnlyCookieError(e)) {
            return;
          }
          logError({
            route: "supabase-server set cookies",
            error: {
              names: cookiesToSet.map(({ name }) => name),
              message: e instanceof Error ? e.message : String(e),
            },
          });
          throw e;
        }
      },
    },
  });
}

function isReadOnlyCookieError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Cookies can only be modified|ReadonlyRequestCookies cannot be modified/i.test(error.message)
  );
}

/** True when the public Supabase env is present enough to attempt auth. */
export function isAuthConfigured(): boolean {
  return Boolean(resolveSupabaseUrl() && resolveSupabasePublishableKey());
}
