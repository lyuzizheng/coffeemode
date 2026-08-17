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

const ALLOWED_SCHEMES = ["http:", "https:"];
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function validateProvider(value: FormDataEntryValue | null): value is OAuthProvider {
  return value === "apple" || value === "google";
}

function getConfiguredSiteHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function getAllowedHosts(): Set<string> {
  const allowed = new Set<string>();
  const configuredHost = getConfiguredSiteHost();
  if (configuredHost) allowed.add(configuredHost);

  const extra = process.env.NEXT_PUBLIC_ALLOWED_HOSTS;
  if (extra) {
    for (const host of extra.split(",")) {
      const trimmed = host.trim();
      if (trimmed) allowed.add(trimmed);
    }
  }
  return allowed;
}

function isLocalhost(host: string): boolean {
  const [name] = host.split(":");
  return LOCALHOST_HOSTS.has(name);
}

function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol)) return false;

  const allowedHosts = getAllowedHosts();
  if (allowedHosts.size > 0) {
    return allowedHosts.has(url.host);
  }

  // When no allowlist is configured, localhost is the only safe default.
  return isLocalhost(url.host);
}

async function getRedirectTo(): Promise<string | null> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (ALLOWED_SCHEMES.includes(url.protocol)) {
        return `${url.origin}/auth/callback`;
      }
    } catch {
      // Fall through to request-header validation.
    }
  }

  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const fallback = origin ?? getProtoHost(requestHeaders);
  if (fallback && isAllowedOrigin(fallback)) {
    return `${fallback}/auth/callback`;
  }

  return null;
}

function getProtoHost(requestHeaders: Headers): string | null {
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const host = requestHeaders.get("host");
  if (!host) return null;

  // Host is just the host (with optional port); x-forwarded-proto gives the scheme.
  // Avoid double-including the scheme if a misconfigured proxy put one in host.
  const cleanHost = host.replace(/^https?:\/\//, "");
  return `${proto}://${cleanHost}`;
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
