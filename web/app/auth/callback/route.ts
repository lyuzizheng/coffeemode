import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { query } from "@/lib/db/neon";
import { upsertProfile } from "@/lib/auth/profiles";

/**
 * OAuth redirect target. Exchanges the authorization code for a session
 * (PKCE verifier comes from the cookie set by signIn), then upserts the
 * Neon profile row before returning the user to the app.
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

  // First-touch profile row. The user id is Supabase's; Neon never sees
  // credentials, only this row keyed by the auth id. A transient Neon
  // failure must not strand the user after a successful OAuth round-trip —
  // the session cookie is already set, and the next callback retries the
  // upsert. Downstream reads treat a missing profile as "create on demand".
  try {
    await upsertProfile(data.user, query);
  } catch (err) {
    console.error("auth/callback: profile upsert failed", err);
  }

  return NextResponse.redirect(new URL("/", origin));
}
