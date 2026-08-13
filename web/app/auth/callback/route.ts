import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { query } from "@/lib/db/postgres";
import { upsertProfile } from "@/lib/auth/profiles";

export const runtime = "nodejs";

/**
 * OAuth redirect target. Exchanges the authorization code for a session
 * (PKCE verifier comes from the cookie set by signIn), then upserts the
 * Postgres profile row before returning the user to the app.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/?auth=error", origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/?auth=error", origin));
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
    console.error("auth/callback: profile upsert failed", err);
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.error("auth/callback: sign-out after failed upsert failed", signOutError);
    }
    return NextResponse.redirect(
      new URL("/?auth=error&reason=profile_upsert", origin),
    );
  }

  return NextResponse.redirect(new URL("/", origin));
}
