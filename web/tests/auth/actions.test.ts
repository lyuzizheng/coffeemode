import { describe, expect, it, vi, beforeEach } from "vitest";
import { signIn, signOut } from "@/lib/auth/actions";

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

const signInWithOAuthMock = vi.fn();
const signOutMock = vi.fn();

const createSupabaseServerClientMock = vi.fn(() => ({
  auth: {
    signInWithOAuth: signInWithOAuthMock,
    signOut: signOutMock,
  },
}));

const headersMock = vi.fn(async () => new Headers({ origin: "http://localhost:3000" }));

const ORIGINAL_ENV = process.env;

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClientMock(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  headersMock.mockReset();
  headersMock.mockImplementation(async () => new Headers({ origin: "http://localhost:3000" }));
  signInWithOAuthMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_ALLOWED_HOSTS;
});

describe("signIn", () => {
  it("returns an error for an unknown provider", async () => {
    const formData = new FormData();
    formData.set("provider", "microsoft");

    const result = await signIn(undefined, formData);
    expect(result).toEqual({ error: "invalid_provider" });
  });

  type OAuthCase = {
    name: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
    provider: "apple" | "google";
    expectedRedirectTo: string;
  };

  it.each<OAuthCase>([
    {
      name: "redirects to the OAuth URL on success",
      provider: "apple",
      expectedRedirectTo: "http://localhost:3000/auth/callback",
    },
    {
      name: "uses NEXT_PUBLIC_SITE_URL over request headers",
      env: { NEXT_PUBLIC_SITE_URL: "https://app.example.com" },
      provider: "google",
      expectedRedirectTo: "https://app.example.com/auth/callback",
    },
    {
      name: "ignores a forged Origin header when NEXT_PUBLIC_SITE_URL is set",
      env: { NEXT_PUBLIC_SITE_URL: "https://app.example.com" },
      headers: { origin: "https://evil.com" },
      provider: "apple",
      expectedRedirectTo: "https://app.example.com/auth/callback",
    },
    {
      name: "allows an allowlisted host via NEXT_PUBLIC_ALLOWED_HOSTS",
      env: { NEXT_PUBLIC_ALLOWED_HOSTS: "staging.example.com" },
      headers: { origin: "https://staging.example.com" },
      provider: "apple",
      expectedRedirectTo: "https://staging.example.com/auth/callback",
    },
    {
      name: "prefers an allowlisted request Origin over NEXT_PUBLIC_SITE_URL",
      env: {
        NEXT_PUBLIC_SITE_URL: "https://app.example.com",
        NEXT_PUBLIC_ALLOWED_HOSTS: "staging.example.com",
      },
      headers: { origin: "https://staging.example.com" },
      provider: "apple",
      expectedRedirectTo: "https://staging.example.com/auth/callback",
    },
    {
      name: "falls back to NEXT_PUBLIC_SITE_URL when the request Origin is not allowed",
      env: { NEXT_PUBLIC_SITE_URL: "https://app.example.com" },
      headers: { origin: "https://evil.com" },
      provider: "apple",
      expectedRedirectTo: "https://app.example.com/auth/callback",
    },
    {
      name: "falls back to x-forwarded-proto and host when Origin is missing",
      headers: { "x-forwarded-proto": "https", host: "localhost:3000" },
      provider: "apple",
      expectedRedirectTo: "https://localhost:3000/auth/callback",
    },
    {
      name: "allows IPv6 localhost",
      headers: { origin: "http://[::1]:3000" },
      provider: "apple",
      expectedRedirectTo: "http://[::1]:3000/auth/callback",
    },
    {
      name: "parses NEXT_PUBLIC_ALLOWED_HOSTS with schemes and ports",
      env: { NEXT_PUBLIC_ALLOWED_HOSTS: "https://staging.example.com, staging.example.com:3000" },
      headers: { origin: "https://staging.example.com:3000" },
      provider: "apple",
      expectedRedirectTo: "https://staging.example.com:3000/auth/callback",
    },
    {
      name: "falls back to request headers when NEXT_PUBLIC_SITE_URL is malformed",
      env: { NEXT_PUBLIC_SITE_URL: "not a url" },
      headers: { origin: "https://localhost:3000" },
      provider: "apple",
      expectedRedirectTo: "https://localhost:3000/auth/callback",
    },
  ])("$name", async ({ env, headers: requestHeaders, provider, expectedRedirectTo }) => {
    if (env) {
      Object.assign(process.env, env);
    }
    if (requestHeaders) {
      headersMock.mockImplementation(async () => new Headers(requestHeaders));
    }
    signInWithOAuthMock.mockResolvedValueOnce({
      data: { url: `https://supabase.example.com/oauth?provider=${provider}` },
      error: null,
    });

    const formData = new FormData();
    formData.set("provider", provider);

    await expect(signIn(undefined, formData)).rejects.toThrow(
      `NEXT_REDIRECT:https://supabase.example.com/oauth?provider=${provider}`,
    );

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider,
      options: {
        redirectTo: expectedRedirectTo,
      },
    });
  });

  it("rejects a non-localhost host when no allowlist is configured", async () => {
    headersMock.mockImplementation(async () => new Headers({ origin: "https://evil.com" }));

    const formData = new FormData();
    formData.set("provider", "apple");

    const result = await signIn(undefined, formData);
    expect(result).toEqual({ error: "not_configured" });
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) origin", async () => {
    headersMock.mockImplementation(async () => new Headers({ origin: "ftp://localhost:3000" }));

    const formData = new FormData();
    formData.set("provider", "apple");

    const result = await signIn(undefined, formData);
    expect(result).toEqual({ error: "not_configured" });
    expect(signInWithOAuthMock).not.toHaveBeenCalled();
  });

  it("returns an error when Supabase fails to produce a URL", async () => {
    signInWithOAuthMock.mockResolvedValueOnce({
      data: { url: null },
      error: { message: "OAuth provider unavailable" },
    });

    const formData = new FormData();
    formData.set("provider", "google");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await signIn(undefined, formData);
    expect(result).toEqual({ error: "provider_start_failed" });
    // Raw provider detail stays in the server log, never reaches the client.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({
      type: "error",
      route: "auth signIn OAuth",
      error: "OAuth provider unavailable",
    });
    spy.mockRestore();
  });
});

describe("signOut", () => {
  it("returns success on success", async () => {
    signOutMock.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    const result = await signOut(undefined, formData);
    expect(result).toEqual({ success: true });
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it("returns an error when sign-out fails", async () => {
    signOutMock.mockResolvedValueOnce({ error: { message: "Session not found" } });

    const formData = new FormData();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await signOut(undefined, formData);
    expect(result).toEqual({ error: "signout_failed" });
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({
      type: "error",
      route: "auth signOut",
      error: "Session not found",
    });
    spy.mockRestore();
  });
});
