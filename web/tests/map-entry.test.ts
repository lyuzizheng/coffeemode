import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * loadMapSession consumes the proxy's x-verified-user handoff (BRAWUKA-644):
 * a verified identity or the verified-anonymous sentinel skips getUser()
 * entirely; an absent or malformed header falls back to the local getUser()
 * so non-cafe routes keep working.
 */

const headersMock = vi.fn<() => Promise<Headers>>();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

const getUserMock = vi.fn();
vi.mock("@/lib/auth/supabase-server", () => ({
  isAuthConfigured: () => true,
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
  })),
}));

const getProfileMock = vi.fn();
vi.mock("@/lib/db/profile", () => ({
  getProfile: (...args: unknown[]) => getProfileMock(...args),
}));

import { loadMapSession } from "@/lib/discovery/map-entry";
import { VERIFIED_USER_HEADER } from "@/lib/auth/verified-user";

function requestHeaders(value?: string): Promise<Headers> {
  const h = new Headers();
  if (value !== undefined) h.set(VERIFIED_USER_HEADER, value);
  return Promise.resolve(h);
}

describe("loadMapSession verified-user handoff (BRAWUKA-644)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersMock.mockImplementation(() => requestHeaders());
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    getProfileMock.mockResolvedValue({ displayName: "Vera" });
  });

  it("reuses the proxy-verified user without a second getUser", async () => {
    headersMock.mockImplementation(() =>
      requestHeaders(
        JSON.stringify({
          id: "verified-user",
          email: "v@example.com",
          user_metadata: { full_name: "Vera" },
        }),
      ),
    );

    const { user, profile } = await loadMapSession();

    expect(getUserMock).not.toHaveBeenCalled();
    expect(user?.id).toBe("verified-user");
    expect(user?.email).toBe("v@example.com");
    expect(getProfileMock).toHaveBeenCalledWith("verified-user");
    expect(profile?.displayName).toBe("Vera");
  });

  it("treats the verified-anonymous sentinel as signed out without getUser", async () => {
    headersMock.mockImplementation(() => requestHeaders("null"));

    const { user, profile } = await loadMapSession();

    expect(getUserMock).not.toHaveBeenCalled();
    expect(getProfileMock).not.toHaveBeenCalled();
    expect(user).toBeNull();
    expect(profile).toBeNull();
  });

  it("falls back to getUser when the header is absent", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "local-user" } },
      error: null,
    });

    const { user } = await loadMapSession();

    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(user?.id).toBe("local-user");
  });

  it("falls back to getUser when the header is malformed", async () => {
    headersMock.mockImplementation(() => requestHeaders("{not json"));
    getUserMock.mockResolvedValue({
      data: { user: { id: "local-user" } },
      error: null,
    });

    const { user } = await loadMapSession();

    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(user?.id).toBe("local-user");
  });

  it("falls back to getUser when the header has no string id", async () => {
    headersMock.mockImplementation(() =>
      requestHeaders(JSON.stringify({ id: 42 })),
    );
    getUserMock.mockResolvedValue({
      data: { user: { id: "local-user" } },
      error: null,
    });

    const { user } = await loadMapSession();

    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(user?.id).toBe("local-user");
  });
});
