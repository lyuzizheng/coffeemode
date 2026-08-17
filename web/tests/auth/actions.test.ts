import { describe, expect, it, vi, beforeEach } from "vitest";
import { signIn, signOut } from "@/app/auth/actions";

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

  it("redirects to the OAuth URL on success", async () => {
    signInWithOAuthMock.mockResolvedValueOnce({
      data: { url: "https://supabase.example.com/oauth?provider=apple" },
      error: null,
    });

    const formData = new FormData();
    formData.set("provider", "apple");

    await expect(signIn(undefined, formData)).rejects.toThrow(
      "NEXT_REDIRECT:https://supabase.example.com/oauth?provider=apple",
    );

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: "http://localhost:3000/auth/callback",
      },
    });
  });

  it("uses NEXT_PUBLIC_SITE_URL over request headers", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com";
    signInWithOAuthMock.mockResolvedValueOnce({
      data: { url: "https://supabase.example.com/oauth?provider=google" },
      error: null,
    });

    const formData = new FormData();
    formData.set("provider", "google");

    await expect(signIn(undefined, formData)).rejects.toThrow("NEXT_REDIRECT:");

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://app.example.com/auth/callback",
      },
    });
  });

  it("ignores a forged Origin header when NEXT_PUBLIC_SITE_URL is set", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com";
    headersMock.mockImplementation(async () => new Headers({ origin: "https://evil.com" }));
    signInWithOAuthMock.mockResolvedValueOnce({
      data: { url: "https://supabase.example.com/oauth?provider=apple" },
      error: null,
    });

    const formData = new FormData();
    formData.set("provider", "apple");

    await expect(signIn(undefined, formData)).rejects.toThrow("NEXT_REDIRECT:");

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: "https://app.example.com/auth/callback",
      },
    });
  });

  it("allows an allowlisted host via NEXT_PUBLIC_ALLOWED_HOSTS", async () => {
    process.env.NEXT_PUBLIC_ALLOWED_HOSTS = "staging.example.com";
    headersMock.mockImplementation(async () => new Headers({ origin: "https://staging.example.com" }));
    signInWithOAuthMock.mockResolvedValueOnce({
      data: { url: "https://supabase.example.com/oauth?provider=apple" },
      error: null,
    });

    const formData = new FormData();
    formData.set("provider", "apple");

    await expect(signIn(undefined, formData)).rejects.toThrow("NEXT_REDIRECT:");

    expect(signInWithOAuthMock).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: "https://staging.example.com/auth/callback",
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
    expect(spy).toHaveBeenCalledWith("signIn: OAuth start failed", "OAuth provider unavailable");
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
    expect(spy).toHaveBeenCalledWith("signOut failed", "Session not found");
    spy.mockRestore();
  });
});
