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
const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function validateProvider(value: FormDataEntryValue | null): value is OAuthProvider {
  return value === "apple" || value === "google";
}

function getConfiguredOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!ALLOWED_SCHEMES.includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseAllowlistEntry(entry: string): { host: string; hostname: string } | null {
  let hostPart = entry;

  if (entry.includes("://") || entry.startsWith("//")) {
    try {
      hostPart = new URL(entry.startsWith("//") ? `http:${entry}` : entry).host;
    } catch {
      return null;
    }
  }

  if (!hostPart || /[/?#]/.test(hostPart)) return null;

  try {
    const url = new URL(`http://${hostPart}`);
    return { host: url.host, hostname: url.hostname };
  } catch {
    return null;
  }
}

function getAllowedHosts(): Set<string> {
  const allowed = new Set<string>();

  const configured = getConfiguredOrigin();
  if (configured) {
    try {
      allowed.add(new URL(configured).host);
    } catch {
      // Malformed configured origin is ignored.
    }
  }

  const extra = process.env.NEXT_PUBLIC_ALLOWED_HOSTS;
  if (extra) {
    for (const entry of extra.split(",")) {
      const parsed = parseAllowlistEntry(entry.trim());
      if (parsed) allowed.add(parsed.host);
    }
  }

  return allowed;
}

function isAllowedHost(host: string, hostname: string): boolean {
  const allowed = getAllowedHosts();
  if (allowed.size > 0) {
    return allowed.has(host);
  }
  return LOCALHOST_HOSTNAMES.has(hostname);
}

function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol)) return false;
  return isAllowedHost(url.host, url.hostname);
}

function getProtoHost(requestHeaders: Headers): string | null {
  const rawProto = requestHeaders.get("x-forwarded-proto");
  const proto = rawProto === "http" ? "http" : "https";
  const host = requestHeaders.get("host");
  if (!host) return null;

  const cleanHost = host.replace(/^https?:\/\//, "");
  if (!cleanHost) return null;

  try {
    const url = new URL(`${proto}://${cleanHost}`);
    if (!ALLOWED_SCHEMES.includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
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
