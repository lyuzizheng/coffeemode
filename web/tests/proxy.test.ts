import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

const SUPABASE_URL = "https://test.supabase.co";
const ANON_KEY = "test-anon-key";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

// Default: every cafe exists, so existing pass-through cases stay intact.
// Two-param signature mirrors cafeExists(id, viewerId): the second arg is
// the VERIFIED user id (via getUser), or null for anonymous/unverifiable.
const cafeExistsMock = vi.fn<(id: string, viewerId?: string | null) => Promise<boolean>>(async () => true);
vi.mock("@/lib/db/cafes", () => ({
  cafeExists: (id: string, viewerId?: string | null) => cafeExistsMock(id, viewerId),
}));

import { createServerClient } from "@supabase/ssr";

describe("proxy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cafeExistsMock.mockResolvedValue(true);
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  });

  it("refreshes the session and forwards refreshed cookies", async () => {
    let capturedSetAll: ((cookiesToSet: unknown[]) => void) | undefined;

    const getSession = vi.fn(async () => {
      capturedSetAll?.([
        { name: "sb-access-token", value: "fresh-token", options: {} },
      ]);
      return { data: { session: { user: { id: "u1" } } }, error: null };
    });
    const getUser = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));

    vi.mocked(createServerClient).mockImplementation(
      (_url: string, _key: string, options: unknown) => {
        const opts = options as { cookies: { setAll?: (cookiesToSet: unknown[]) => void } };
        capturedSetAll = opts.cookies.setAll;
        return { auth: { getSession, getUser } } as unknown as ReturnType<typeof createServerClient>;
      },
    );

    const req = new NextRequest(new URL("http://localhost/cafes/c1"), {
      headers: new Headers(),
    });
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(res.cookies.get("sb-access-token")?.value).toBe("fresh-token");
    expect(res.status).toBe(200);
  });

  it("uses one client so token rotation is persisted (no forced logout)", async () => {
    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })), getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL("http://localhost/api/cafes"), {
      headers: new Headers(),
    });
    req.cookies.set("sb-access-token", "stale-token");

    await proxy(req);
    expect(createServerClient).toHaveBeenCalledTimes(1);
  });

  it("skips getUser on non-cafe routes", async () => {
    const getSession = vi.fn(async () => ({ data: { session: { user: { id: "u1" } } }, error: null }));
    const getUser = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));

    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession, getUser } }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL("http://localhost/api/cafes"), {
      headers: new Headers(),
    });
    req.cookies.set("sb-access-token", "stale-token");

    await proxy(req);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("falls through when supabase env is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const req = new NextRequest(new URL("http://localhost/cafes/c1"), {
      headers: new Headers(),
    });
    const res = await proxy(req);

    expect(createServerClient).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("falls through when session refresh throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const getSession = vi.fn(async () => {
      throw new Error("Supabase unreachable");
    });
    const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));

    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession, getUser } }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL("http://localhost/cafes/c1"), {
      headers: new Headers(),
    });
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("skips getSession when there are no Supabase session cookies", async () => {
    const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));

    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession } }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL("http://localhost/cafes/c1"), {
      headers: new Headers(),
    });

    const res = await proxy(req);

    expect(getSession).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("skips getSession when only unrelated cookies are present", async () => {
    const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));

    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession } }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL("http://localhost/cafes/c1"), {
      headers: new Headers(),
    });
    req.cookies.set("analytics_id", "abc");
    req.cookies.set("consent", "yes");

    const res = await proxy(req);

    expect(getSession).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

describe("proxy gone-cafe 404 (DG19)", () => {
  const CAFE = "550e8400-e29b-41d4-a716-446655440001";

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  });

  it("rewrites a missing cafe page to the sync 404 target", async () => {
    cafeExistsMock.mockResolvedValue(false);
    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    const res = await proxy(req);
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "http://localhost/__gone-cafe",
    );
  });

  it("lets existing cafes through to the page", async () => {
    cafeExistsMock.mockResolvedValue(true);
    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    const res = await proxy(req);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("checks subpath requests and non-GET methods never", async () => {
    cafeExistsMock.mockResolvedValue(false);
    const og = new NextRequest(new URL(`http://localhost/cafes/${CAFE}/og-image`));
    expect((await proxy(og)).headers.get("x-middleware-rewrite")).toBeNull();
    const post = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`), { method: "POST" });
    expect((await proxy(post)).headers.get("x-middleware-rewrite")).toBeNull();
    expect(cafeExistsMock).not.toHaveBeenCalled();
  });

  it("fails open when the existence check cannot reach the DB", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cafeExistsMock.mockRejectedValue(new Error("connection refused"));
    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    const res = await proxy(req);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).toBe(200);
    errorSpy.mockRestore();
  });
  it("strips an inbound x-gone-cafe-id so clients cannot inject the marker", async () => {
    const req = new NextRequest(new URL("http://localhost/"), {
      headers: { "x-gone-cafe-id": "spoofed" },
    });
    const res = await proxy(req);
    // The sanitized request replaces the header set: the spoofed value must
    // not be forwarded to rendering.
    expect(res.headers.get("x-middleware-request-x-gone-cafe-id")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("passes the verified user id to the visibility check (BRAWUKA-315)", async () => {
    cafeExistsMock.mockResolvedValue(true);
    const getSession = vi.fn(async () => ({
      data: { session: { user: { id: "spoofable-id" } } },
      error: null,
    }));
    const getUser = vi.fn(async () => ({
      data: { user: { id: "verified-user" } },
      error: null,
    }));
    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession, getUser } }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);
    expect(res.status).toBe(200);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(cafeExistsMock).toHaveBeenCalledWith(CAFE, "verified-user");
  });

  it("passes null when the session cannot be verified (BRAWUKA-315)", async () => {
    cafeExistsMock.mockResolvedValue(true);
    const getSession = vi.fn(async () => ({
      data: { session: { user: { id: "spoofable-id" } } },
      error: null,
    }));
    const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession, getUser } }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    req.cookies.set("sb-access-token", "forged-token");

    await proxy(req);
    expect(cafeExistsMock).toHaveBeenCalledWith(CAFE, null);
  });

  it("passes null with no session cookies and skips verification (BRAWUKA-315)", async () => {
    cafeExistsMock.mockResolvedValue(true);
    const getUser = vi.fn(async () => ({
      data: { user: { id: "must-not-be-used" } },
      error: null,
    }));
    vi.mocked(createServerClient).mockImplementation(
      () =>
        ({
          auth: {
            getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
            getUser,
          },
        }) as unknown as ReturnType<typeof createServerClient>,
    );

    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    await proxy(req);
    expect(createServerClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(cafeExistsMock).toHaveBeenCalledWith(CAFE, null);
  });
});

describe("proxy matcher", () => {
  // The matcher string is a regex with a literal leading slash. Anchor it to
  // the full pathname for the unit test.
  const pattern = new RegExp(`^${config.matcher[0]}$`);

  it("matches pages and API routes", () => {
    expect("/cafes/c1").toMatch(pattern);
    expect("/api/cafes").toMatch(pattern);
    expect("/profile").toMatch(pattern);
  });

  it("excludes static and PWA assets", () => {
    expect("/_next/static/chunk.js").not.toMatch(pattern);
    expect("/serwist/sw.js").not.toMatch(pattern);
    expect("/icons/icon-192.png").not.toMatch(pattern);
    expect("/fonts/inter-var.woff2").not.toMatch(pattern);
    expect("/manifest.webmanifest").not.toMatch(pattern);
  });


  it("excludes the heartbeat and runtime-config probes (BRAWUKA-284)", () => {
    expect("/api/health").not.toMatch(pattern);
    expect("/api/health/ready").not.toMatch(pattern);
    expect("/api/heartbeat").not.toMatch(pattern);
    expect("/api/config").not.toMatch(pattern);
  });

  it("includes places API routes for session refresh", () => {
    expect("/api/places/search").toMatch(pattern);
    expect("/api/places/resolve").toMatch(pattern);
    expect("/api/places/external").toMatch(pattern);
  });
});

describe("proxy request-id (BRAWUKA-168)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cafeExistsMock.mockResolvedValue(true);
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  async function accessLine(res: Response): Promise<Record<string, unknown>> {
    const logSpy = vi.mocked(console.log);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [raw] = logSpy.mock.calls[0];
    const line = JSON.parse(raw as string) as Record<string, unknown>;
    expect(line).toMatchObject({ type: "access", status: res.status });
    return line;
  }

  it("generates, echoes, and access-logs one id per request", async () => {
    const res = await proxy(new NextRequest(new URL("http://localhost/api/cafes")));
    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect((await accessLine(res)).request_id).toBe(requestId);
  });

  it("reuses a valid inbound id so error lines correlate", async () => {
    const inbound = crypto.randomUUID();
    const res = await proxy(
      new NextRequest(new URL("http://localhost/api/cafes"), {
        headers: new Headers({ "x-request-id": inbound }),
      }),
    );
    expect(res.headers.get("x-request-id")).toBe(inbound);
    expect((await accessLine(res)).request_id).toBe(inbound);
  });

  it("regenerates a forged inbound id", async () => {
    const res = await proxy(
      new NextRequest(new URL("http://localhost/api/cafes"), {
        headers: new Headers({ "x-request-id": "attacker-chosen" }),
      }),
    );
    const requestId = res.headers.get("x-request-id");
    expect(requestId).not.toBe("attacker-chosen");
    expect((await accessLine(res)).request_id).toBe(requestId);
  });

  it("never logs the OAuth code in access lines (BRAWUKA-282 P1-3 gate)", async () => {
    const res = await proxy(
      new NextRequest(new URL("http://localhost/auth/callback?code=pkce-code-abc&next=/cafes")),
    );
    const line = await accessLine(res);
    expect(line.path).toBe("/auth/callback");
    expect(JSON.stringify(line)).not.toContain("code=");
    expect(JSON.stringify(line)).not.toContain("pkce-code-abc");
  });

  it("never logs raw search terms in access lines (BRAWUKA-282 P1-3 gate)", async () => {
    const res = await proxy(
      new NextRequest(new URL("http://localhost/api/search?q=night+owl+espresso")),
    );
    const line = await accessLine(res);
    expect(line.path).toBe("/api/search");
    expect(JSON.stringify(line)).not.toContain("night");
  });
});
