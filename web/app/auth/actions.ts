"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

/**
 * OAuth entry points (spec 0001: Supabase is AUTH ONLY, Apple + Google).
 * PKCE is handled by @supabase/ssr — the code verifier lives in a cookie,
 * the callback exchanges the code for a session.
 */

export type OAuthProvider = "apple" | "google";

export async function signIn(provider: OAuthProvider) {
  const supabase = await createSupabaseServerClient();
  const origin = (await headers()).get("origin") ?? "";

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error || !data.url) {
    // Surface as a thrown error so the UI can show a toast; do not leak
    // provider internals beyond the message Supabase already returns.
    throw new Error(error?.message ?? "Sign-in could not start");
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
