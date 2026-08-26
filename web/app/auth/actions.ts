"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import {
  getConfiguredOrigin,
  getProtoHost,
  isAllowedOrigin,
} from "@/lib/security/origin";

/**
 * OAuth entry points (spec 0001: Supabase is AUTH ONLY, Apple + Google).
 * PKCE is handled by @supabase/ssr — the code verifier lives in a cookie,
 * the callback exchanges the code for a session.
 */

export type OAuthProvider = "apple" | "google";

/**
 * Error values are stable CODES, never provider strings — the UI maps them to
 * localized copy (auth-error-message.tsx), so no raw English provider text
 * reaches a bilingual surface (issue #103). The raw Supabase message goes to
 * the server log instead.
 */
export type AuthActionState = {
  error?: "invalid_provider" | "not_configured" | "provider_start_failed" | "signout_failed";
  success?: boolean;
};

function validateProvider(value: FormDataEntryValue | null): value is OAuthProvider {
  return value === "apple" || value === "google";
}

async function getRedirectTo(): Promise<string | null> {
  const requestHeaders = await headers();
  const originHeader = requestHeaders.get("origin");
  const requestOrigin = originHeader ? (isAllowedOrigin(originHeader) ? originHeader : null) : getProtoHost(requestHeaders);

  if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    return `${requestOrigin}/auth/callback`;
  }

  const configuredOrigin = getConfiguredOrigin();
  if (configuredOrigin && isAllowedOrigin(configuredOrigin)) {
    return `${configuredOrigin}/auth/callback`;
  }

  return null;
}

export async function signIn(
  _prevState: AuthActionState | undefined,
  formData: FormData,
): Promise<AuthActionState> {
  const provider = formData.get("provider");
  if (!validateProvider(provider)) {
    return { error: "invalid_provider" };
  }

  const redirectTo = await getRedirectTo();
  if (!redirectTo) {
    return { error: "not_configured" };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });

  if (error || !data.url) {
    // Keep the provider detail in the server log; the client gets a stable
    // code mapped to localized copy — no raw English provider strings in the
    // UI (issue #103).
    console.error("signIn: OAuth start failed", error?.message ?? "no url");
    return { error: "provider_start_failed" };
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
    console.error("signOut failed", error.message);
    return { error: "signout_failed" };
  }

  // The client clears the TanStack Query cache and IndexedDB persister after
  // receiving this success state, then redirects home.
  return { success: true };
}
