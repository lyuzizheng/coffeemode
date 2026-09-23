import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "@/app/auth/callback/route";

const exchangeCodeForSessionMock = vi.fn();
const signOutMock = vi.fn();

const createSupabaseServerClientMock = vi.fn(() => ({
  auth: {
    exchangeCodeForSession: exchangeCodeForSessionMock,
    signOut: signOutMock,
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
  signOutMock.mockReset();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.NEXT_PUBLIC_ALLOWED_HOSTS;
});

// Real requests always carry a Host header; undici's Request does not
// synthesize one from the URL, so tests set it explicitly.
const LOCALHOST = { host: "localhost:3000" };

describe("GET /auth/callback", () => {
  it("redirects to an error page when the code is missing", async () => {
    const res = await GET(new Request("http://localhost:3000/auth/callback", { headers: LOCALHOST }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });

  it("redirects home after a successful code exchange and profile upsert", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "test@example.com" } },
      error: null,
    });
    upsertProfileMock.mockResolvedValue({ id: "user-1", inserted: true });

    const res = await GET(new Request("http://localhost:3000/auth/callback?code=abc", { headers: LOCALHOST }));

    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("abc");
    expect(upsertProfileMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("falls back to / for backslash protocol-relative next (BRAWUKA-282 P2-5 gate)", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    upsertProfileMock.mockResolvedValue({ id: "user-1", inserted: true });

    for (const next of ["/\\evil.example", "/%5cevil.example", "//evil.example", "/%2f%2fevil.example"]) {
      const res = await GET(
        new Request(`http://localhost:3000/auth/callback?code=abc&next=${next}`, { headers: LOCALHOST }),
      );
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    }
  });

  it("still honors a plain internal next path", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    upsertProfileMock.mockResolvedValue({ id: "user-1", inserted: true });

    const res = await GET(
      new Request("http://localhost:3000/auth/callback?code=abc&next=%2Fcafes%2F123", { headers: LOCALHOST }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/cafes/123");
  });

  it("redirects to an error page when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid code" },
    });

    const res = await GET(new Request("http://localhost:3000/auth/callback?code=bad", { headers: LOCALHOST }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/?auth=error");
  });

  it("redirects to an error page and signs out when the profile upsert fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "test@example.com" } },
      error: null,
    });
    upsertProfileMock.mockRejectedValue(new Error("Postgres is down"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(new Request("http://localhost:3000/auth/callback?code=abc", { headers: LOCALHOST }));

    expect(upsertProfileMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/?auth=error&reason=profile_upsert",
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [raw] = errorSpy.mock.calls[0];
    const line = JSON.parse(raw as string) as Record<string, unknown>;
    expect(line).toMatchObject({
      type: "error",
      route: "GET /auth/callback profile-upsert",
      error: "Postgres is down",
    });
    expect(typeof line.request_id).toBe("string");

    errorSpy.mockRestore();
  });

  it("still redirects if sign-out fails after a profile upsert failure", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "test@example.com" } },
      error: null,
    });
    upsertProfileMock.mockRejectedValue(new Error("Postgres is down"));
    signOutMock.mockRejectedValue(new Error("Sign-out failed"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(new Request("http://localhost:3000/auth/callback?code=abc", { headers: LOCALHOST }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/?auth=error&reason=profile_upsert",
    );

    errorSpy.mockRestore();
  });
  it("redirects to NEXT_PUBLIC_SITE_URL when the request origin is the internal listener (BRAWUKA-558)", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.cafemood.app";
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    upsertProfileMock.mockResolvedValue({ id: "user-1", inserted: true });

    // Staging standalone server: request.url resolves to http://0.0.0.0:3000
    // and the proxy forwards Host: 0.0.0.0:3000 — neither is allowlisted, so
    // the configured public origin must win.
    const res = await GET(
      new Request("http://0.0.0.0:3000/auth/callback?code=abc", {
        headers: { host: "0.0.0.0:3000", "x-forwarded-proto": "https" },
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://staging.cafemood.app/");
  });

  it("redirects via x-forwarded-proto + allowlisted host, ignoring request.url's origin", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://cafemood.app";
    process.env.NEXT_PUBLIC_ALLOWED_HOSTS = "staging.cafemood.app";
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    upsertProfileMock.mockResolvedValue({ id: "user-1", inserted: true });

    const res = await GET(
      new Request("http://0.0.0.0:3000/auth/callback?code=abc", {
        headers: { host: "staging.cafemood.app", "x-forwarded-proto": "https" },
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://staging.cafemood.app/");
  });

  it("ignores a forged x-forwarded-host and falls back to the configured origin (BRAWUKA-282)", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.cafemood.app";
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    upsertProfileMock.mockResolvedValue({ id: "user-1", inserted: true });

    const res = await GET(
      new Request("http://0.0.0.0:3000/auth/callback?code=abc", {
        headers: {
          host: "staging.cafemood.app",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://staging.cafemood.app/");
  });

  it("emits a relative Location when no origin is resolvable", async () => {
    const res = await GET(new Request("http://0.0.0.0:3000/auth/callback"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/?auth=error");
  });
});

