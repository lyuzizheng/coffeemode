import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { upsertProfile } from "@/lib/auth/profiles";
import { query } from "@/lib/db/postgres";
import { recordLogin } from "@/lib/observability/metrics";
import { logError } from "@/lib/observability/server-log";

/**
 * Session-establishment tail shared by both auth entry points (BRAWUKA-956):
 * `GET /auth/callback` (PKCE code or email OTP) and `POST /api/auth/session`
 * (magic-link tokens read from the URL hash). Either way the Supabase session
 * already exists in the cookie jar; what remains is the profile row.
 */

interface CompleteSignInInput {
  request: Request;
  supabase: SupabaseClient;
  user: User;
  /** Log label of the calling route, e.g. `"GET /auth/callback"`. */
  route: string;
}

/**
 * Upsert the profile row and count the login. A transient Postgres failure
 * after a successful Supabase round-trip surfaces as a clear error so the user
 * can retry; the next sign-in runs this tail again. The user is signed out so
 * they do not end up with an active session but no profile row.
 *
 * `false` means the caller must send the user to the auth error surface.
 */
export async function completeSignIn({
  request,
  supabase,
  user,
  route,
}: CompleteSignInInput): Promise<boolean> {
  try {
    await upsertProfile(user, query);
  } catch (err) {
    logError({ route: `${route} profile-upsert`, request, error: err });
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      logError({ route: `${route} sign-out`, request, error: signOutError });
    }
    return false;
  }

  // Only now is it a login: the credentials verified *and* the profile row
  // landed. A tail that fails either step signs the user back out above, so
  // counting there would report sessions that never existed (BRAWUKA-609).
  recordLogin();
  return true;
}
