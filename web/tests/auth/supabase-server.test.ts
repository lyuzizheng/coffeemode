import { describe, expect, it, vi, beforeEach } from "vitest";

const createServerClientMock = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: () => [{ name: "test", value: "value" }],
    set: setCookieMock,
  })),
}));

const setCookieMock = vi.fn();

import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { cookies } from "next/headers";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  setCookieMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
});

describe("createSupabaseServerClient", () => {
  it("sets cookies successfully in a writable context", async () => {
    let capturedSetAll: ((cookiesToSet: unknown[]) => void) | undefined;

    createServerClientMock.mockImplementation(
      (_url: string, _key: string, options: { cookies: { setAll?: (cookiesToSet: unknown[]) => void } }) => {
        capturedSetAll = options.cookies.setAll;
        return { auth: {} };
      },
    );

    await createSupabaseServerClient();
    expect(capturedSetAll).toBeDefined();

    capturedSetAll!([
      { name: "sb-access-token", value: "fresh", options: {} },
    ]);

    expect(setCookieMock).toHaveBeenCalledWith("sb-access-token", "fresh", {});
  });

  it("ignores the read-only cookie error from Server Components", async () => {
    let capturedSetAll: ((cookiesToSet: unknown[]) => void) | undefined;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    createServerClientMock.mockImplementation(
      (_url: string, _key: string, options: { cookies: { setAll?: (cookiesToSet: unknown[]) => void } }) => {
        capturedSetAll = options.cookies.setAll;
        return { auth: {} };
      },
    );

    setCookieMock.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
    });

    await createSupabaseServerClient();

    expect(() =>
      capturedSetAll!([
        { name: "sb-access-token", value: "fresh", options: {} },
      ]),
    ).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("rethrows and logs other cookie set errors", async () => {
    let capturedSetAll: ((cookiesToSet: unknown[]) => void) | undefined;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    createServerClientMock.mockImplementation(
      (_url: string, _key: string, options: { cookies: { setAll?: (cookiesToSet: unknown[]) => void } }) => {
        capturedSetAll = options.cookies.setAll;
        return { auth: {} };
      },
    );

    setCookieMock.mockImplementation(() => {
      throw new Error("Cookie value is too large");
    });

    await createSupabaseServerClient();

    expect(() =>
      capturedSetAll!([
        { name: "sb-access-token", value: "fresh", options: {} },
      ]),
    ).toThrow("Cookie value is too large");

    expect(errorSpy).toHaveBeenCalledWith(
      "supabase-server: failed to set cookies",
      expect.objectContaining({
        names: ["sb-access-token"],
        error: "Cookie value is too large",
      }),
    );

    errorSpy.mockRestore();
  });

  it("throws when Supabase env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await expect(createSupabaseServerClient()).rejects.toThrow("Supabase is not configured");
  });
});
