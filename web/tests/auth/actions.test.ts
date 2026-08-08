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
});

describe("signIn", () => {
  it("returns an error for an unknown provider", async () => {
    const formData = new FormData();
    formData.set("provider", "microsoft");

    const result = await signIn(undefined, formData);
    expect(result).toEqual({ error: "Invalid sign-in provider" });
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

  it("returns an error when Supabase fails to produce a URL", async () => {
    signInWithOAuthMock.mockResolvedValueOnce({
      data: { url: null },
      error: { message: "OAuth provider unavailable" },
    });

    const formData = new FormData();
    formData.set("provider", "google");

    const result = await signIn(undefined, formData);
    expect(result).toEqual({ error: "OAuth provider unavailable" });
  });
});

describe("signOut", () => {
  it("redirects to / on success", async () => {
    signOutMock.mockResolvedValueOnce({ error: null });

    const formData = new FormData();
    await expect(signOut(undefined, formData)).rejects.toThrow("NEXT_REDIRECT:/");
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it("returns an error when sign-out fails", async () => {
    signOutMock.mockResolvedValueOnce({ error: { message: "Session not found" } });

    const formData = new FormData();
    const result = await signOut(undefined, formData);
    expect(result).toEqual({ error: "Session not found" });
  });
});
