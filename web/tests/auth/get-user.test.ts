import { describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  createSupabaseServerClient,
  isAuthConfigured,
} from "@/lib/auth/supabase-server";

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
  isAuthConfigured: vi.fn(),
}));

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

describe("getCurrentUser", () => {
  it("returns null when auth is not configured", async () => {
    vi.mocked(isAuthConfigured).mockReturnValue(false);

    const user = await getCurrentUser();

    expect(user).toBeNull();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("returns the user id when the session is valid", async () => {
    vi.mocked(isAuthConfigured).mockReturnValue(true);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);

    const user = await getCurrentUser();

    expect(user).toEqual({ id: "user-123" });
  });

  it("returns null when there is no active session", async () => {
    vi.mocked(isAuthConfigured).mockReturnValue(true);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);

    const user = await getCurrentUser();

    expect(user).toBeNull();
  });

  it("returns null and logs when getUser() throws a network error", async () => {
    vi.mocked(isAuthConfigured).mockReturnValue(true);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error("network blip")),
      },
    } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);

    const user = await getCurrentUser();

    expect(user).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "getCurrentUser failed:",
      expect.any(Error),
    );
  });
});
