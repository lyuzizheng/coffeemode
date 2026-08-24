import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

const SUPABASE_URL = "https://test.supabase.co";
const ANON_KEY = "test-anon-key";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

// Default: every cafe exists, so existing pass-through cases stay intact.
const cafeExistsMock = vi.fn<(id: string) => Promise<boolean>>(async () => true);
vi.mock("@/lib/db/cafes", () => ({
  cafeExists: (id: string) => cafeExistsMock(id),
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

    vi.mocked(createServerClient).mockImplementation(
      (_url: string, _key: string, options: unknown) => {
        const opts = options as { cookies: { setAll?: (cookiesToSet: unknown[]) => void } };
        capturedSetAll = opts.cookies.setAll;
        return { auth: { getSession } } as unknown as ReturnType<typeof createServerClient>;
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

    vi.mocked(createServerClient).mockImplementation(
      () => ({ auth: { getSession } }) as unknown as ReturnType<typeof createServerClient>,
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

  it("excludes public/no-auth API routes", () => {
    expect("/api/health").not.toMatch(pattern);
    expect("/api/health/ready").not.toMatch(pattern);
    expect("/api/places/search").not.toMatch(pattern);
    expect("/api/places/resolve").not.toMatch(pattern);
  });
});
