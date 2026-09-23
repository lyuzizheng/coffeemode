import { logError } from "@/lib/observability/server-log";
import { recordLogin } from "@/lib/observability/metrics";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { query } from "@/lib/db/postgres";
import { upsertProfile } from "@/lib/auth/profiles";
import { isSafeReturnPath } from "@/lib/auth/safe-path";
import { redirectToPath } from "@/lib/security/origin";

export const runtime = "nodejs";

/**
 * OAuth redirect target. Exchanges the authorization code for a session
 * (PKCE verifier comes from the cookie set by signIn), then upserts the
 * Postgres profile row before returning the user to the app.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // Redirects go through redirectToPath: `request.url`'s origin is the
  // internal listener (`http://0.0.0.0:3000`) behind the staging proxy, not
  // the public site (BRAWUKA-558).
  if (!code) {
    return redirectToPath(request, "/?auth=error");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return redirectToPath(request, "/?auth=error");
  }

  // First-touch profile row. The user id is Supabase's; Postgres never sees
  // credentials, only this row keyed by the auth id. A transient Postgres
  // failure after a successful OAuth round-trip should surface as a clear
  // error so the user can retry; the next sign-in will run this callback again
  // with a fresh code and retry the upsert. Sign the user out so they do not
  // end up with an active session but no profile row.
  try {
    await upsertProfile(data.user, query);
  } catch (err) {
    logError({ route: "GET /auth/callback profile-upsert", request, error: err });
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      logError({ route: "GET /auth/callback sign-out", request, error: signOutError });
    }
    return redirectToPath(request, "/?auth=error&reason=profile_upsert");
  }

  // Only now is it a login: the code exchanged *and* the profile row landed.
  // A callback that fails either step signs the user back out above, so
  // counting there would report sessions that never existed (BRAWUKA-609).
  recordLogin();

  const next = searchParams.get("next");
  const returnPath = isSafeReturnPath(next) ? next : "/";

  return redirectToPath(request, returnPath);
}
