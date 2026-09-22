import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { CAFE_SHELL_BYPASS_CACHE_CONTROL } from "@/lib/cache-policy";

const SUPABASE_URL = "https://test.supabase.co";
const ANON_KEY = "test-anon-key";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from "@supabase/ssr";


describe("proxy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

describe("proxy legacy /?cafe= redirect (DG124)", () => {
  const CAFE = "550e8400-e29b-41d4-a716-446655440001";

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  });

  it("308-redirects /?cafe=<uuid> to the canonical cafe URL without the query", async () => {
    const req = new NextRequest(new URL(`http://localhost/?cafe=${CAFE}`));
    const res = await proxy(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`http://localhost/cafes/${CAFE}`);
    // The retired param must not ride along — the canonical URL is bare.
    expect(res.headers.get("location")).not.toContain("cafe=");
  });

  it("strips every other query param from the redirect target", async () => {
    const req = new NextRequest(new URL(`http://localhost/?cafe=${CAFE}&utm_source=share&lang=zh`));
    const res = await proxy(req);

    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`http://localhost/cafes/${CAFE}`);
  });

  it("lets / without a valid cafe param through to the home page", async () => {
    for (const path of ["/", "/?cafe=not-a-uuid", "/?cafe=", "/?q=1"]) {
      const res = await proxy(new NextRequest(new URL(`http://localhost${path}`)));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("never redirects a cafe param on non-root paths", async () => {
    const res = await proxy(new NextRequest(new URL(`http://localhost/profile?cafe=${CAFE}`)));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("skips session refresh for redirected requests", async () => {
    const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));
    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession, getUser: vi.fn() } }) as never,
    );
    const req = new NextRequest(new URL(`http://localhost/?cafe=${CAFE}`));
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);

    expect(res.status).toBe(308);
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe("proxy cafe page pass-through (DG19, BRAWUKA-658)", () => {
  const CAFE = "550e8400-e29b-41d4-a716-446655440001";

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  });

  // The proxy no longer probes cafe existence: the page's generateMetadata()
  // commits the real 404 via notFound() (no loading boundary wraps the
  // route), so a proxy-side probe would only duplicate the page's getCafe
  // query. These tests pin the pass-through so the probe cannot creep back.
  it("passes cafe page GETs through untouched — no rewrite, no probe", async () => {
    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    const res = await proxy(req);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-gone-cafe-id")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("passes invalid cafe ids through — the page 404s them itself", async () => {
    const req = new NextRequest(new URL("http://localhost/cafes/definitely-not-a-cafe"));
    const res = await proxy(req);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("never rewrites cafe subpaths or non-GET methods", async () => {
    const og = new NextRequest(new URL(`http://localhost/cafes/${CAFE}/og-image`));
    expect((await proxy(og)).headers.get("x-middleware-rewrite")).toBeNull();
    const post = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`), { method: "POST" });
    expect((await proxy(post)).headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("still forwards rotated session cookies on cafe pages (BRAWUKA-315 P1)", async () => {
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
        return { auth: { getSession, getUser } } as never;
      },
    );

    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);
    // Rotated token must reach the browser on the pass-through response —
    // a dropped Set-Cookie forces a logout on the next refresh.
    expect(res.cookies.get("sb-access-token")?.value).toBe("fresh-token");
  });
});

describe("proxy verified-user handoff (BRAWUKA-644)", () => {
  const CAFE = "550e8400-e29b-41d4-a716-446655440001";
  const FORWARDED = "x-middleware-request-x-verified-user";

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  });

  function stubAuth({
    user,
    refresh = false,
  }: {
    user: Record<string, unknown> | null;
    refresh?: boolean;
  }) {
    let capturedSetAll: ((cookiesToSet: unknown[]) => void) | undefined;
    const getSession = vi.fn(async () => {
      if (refresh) {
        capturedSetAll?.([
          { name: "sb-access-token", value: "fresh-token", options: {} },
        ]);
      }
      return { data: { session: user ? { user } : null }, error: null };
    });
    const getUser = vi.fn(async () => ({ data: { user }, error: null }));
    vi.mocked(createServerClient).mockImplementation(
      (_url: string, _key: string, options: unknown) => {
        const opts = options as { cookies: { setAll?: (c: unknown[]) => void } };
        capturedSetAll = opts.cookies.setAll;
        return { auth: { getSession, getUser } } as never;
      },
    );
    return { getSession, getUser };
  }

  function cafeRequest() {
    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`));
    req.cookies.set("sb-access-token", "stale-token");
    return req;
  }

  it("forwards the verified user subset so the page skips a second getUser", async () => {
    stubAuth({
      user: {
        id: "verified-user",
        email: "v@example.com",
        user_metadata: { full_name: "Vera" },
        phone: "must-not-leak",
        app_metadata: { provider: "google" },
      },
    });

    const res = await proxy(cafeRequest());

    const forwarded = res.headers.get(FORWARDED);
    expect(forwarded).not.toBeNull();
    expect(JSON.parse(forwarded as string)).toEqual({
      id: "verified-user",
      email: "v@example.com",
      user_metadata: { full_name: "Vera" },
    });
  });

  it("forwards verified-anonymous so the page does not re-verify", async () => {
    stubAuth({ user: null });

    const res = await proxy(cafeRequest());

    expect(res.headers.get(FORWARDED)).toBe("null");
  });

  it("keeps the header and rotated cookies when the session refreshes", async () => {
    stubAuth({ user: { id: "verified-user" }, refresh: true });

    const res = await proxy(cafeRequest());

    // The refresh rebuilds the response inside setAll; the header forward
    // must rebuild again without dropping the rotated cookie (BRAWUKA-315).
    expect(JSON.parse(res.headers.get(FORWARDED) as string)).toEqual({
      id: "verified-user",
    });
    expect(res.cookies.get("sb-access-token")?.value).toBe("fresh-token");
    expect(res.headers.get("cache-control")).toBe(
      CAFE_SHELL_BYPASS_CACHE_CONTROL,
    );
  });

  it("writes no header when verification throws — the page retries", async () => {
    const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));
    const getUser = vi.fn(async () => {
      throw new Error("Supabase unreachable");
    });
    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession, getUser } }) as never,
    );

    const res = await proxy(cafeRequest());

    expect(res.headers.get(FORWARDED)).toBeNull();
    expect(res.status).toBe(200);
  });

  it("strips an inbound x-verified-user so clients cannot inject identity", async () => {
    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`), {
      headers: {
        "x-verified-user": JSON.stringify({ id: "attacker-id" }),
      },
    });

    const res = await proxy(req);

    // No session cookie → no verification → the spoofed value must be gone.
    expect(res.headers.get(FORWARDED)).toBeNull();
  });

  it("overwrites a spoofed header with the verified identity", async () => {
    stubAuth({ user: { id: "verified-user" } });
    const req = cafeRequest();
    req.headers.set("x-verified-user", JSON.stringify({ id: "attacker-id" }));

    const res = await proxy(req);

    expect(JSON.parse(res.headers.get(FORWARDED) as string)).toEqual({
      id: "verified-user",
    });
  });

  it("writes no header on non-cafe routes", async () => {
    stubAuth({ user: { id: "verified-user" } });
    const req = new NextRequest(new URL("http://localhost/api/cafes"));
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);

    expect(res.headers.get(FORWARDED)).toBeNull();
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
