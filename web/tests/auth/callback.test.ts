import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "@/app/auth/callback/route";

const exchangeCodeForSessionMock = vi.fn();

const createSupabaseServerClientMock = vi.fn(() => ({
  auth: {
    exchangeCodeForSession: exchangeCodeForSessionMock,
  },
}));

const upsertProfileMock = vi.fn();

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => createSupabaseServerClientMock(),
}));

vi.mock("@/lib/auth/profiles", () => ({
  upsertProfile: (user: unknown, runQuery: unknown) => upsertProfileMock(user, runQuery),
}));

beforeEach(() => {
  vi.clearAllMocks();
  upsertProfileMock.mockReset();
  exchangeCodeForSessionMock.mockReset();
});

describe("GET /auth/callback", () => {
  it("redirects to an error page when the code is missing", async () => {
    const res = await GET(new Request("http://localhost:3000/auth/callback"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });

  it("redirects home after a successful code exchange and profile upsert", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "test@example.com" } },
      error: null,
    });
    upsertProfileMock.mockResolvedValue({ id: "user-1", inserted: true });

    const res = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));

    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("abc");
    expect(upsertProfileMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects to an error page when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid code" },
    });

    const res = await GET(new Request("http://localhost:3000/auth/callback?code=bad"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });

  it("redirects to an error page when the profile upsert fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "test@example.com" } },
      error: null,
    });
    upsertProfileMock.mockRejectedValue(new Error("Postgres is down"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));

    expect(upsertProfileMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/?auth=error&reason=profile_upsert",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "auth/callback: profile upsert failed",
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});
