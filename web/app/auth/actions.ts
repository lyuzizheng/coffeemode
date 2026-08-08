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

export type AuthActionState = {
  error?: string;
};

function validateProvider(value: FormDataEntryValue | null): value is OAuthProvider {
  return value === "apple" || value === "google";
}

async function getOriginHeader(): Promise<string> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin) return origin;

  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const host = requestHeaders.get("host");
  if (host) return `${proto}://${host}`;

  return "";
}

export async function signIn(
  _prevState: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState> {
  const provider = formData.get("provider");
  if (!validateProvider(provider)) {
    return { error: "Invalid sign-in provider" };
  }

  const supabase = await createSupabaseServerClient();
  const origin = await getOriginHeader();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error || !data.url) {
    // Surface as a returned error so the UI can show a toast; do not leak
    // provider internals beyond the message Supabase already returns.
    return { error: error?.message ?? "Sign-in could not start" };
  }

  redirect(data.url);
}

export async function signOut(
  _prevState: AuthActionState | undefined,
  _formData: FormData,
): Promise<AuthActionState> {
  // State and payload are required by useActionState but unused here.
  void _prevState;
  void _formData;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return { error: error.message };
  }

  redirect("/");
}
