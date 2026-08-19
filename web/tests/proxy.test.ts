import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";

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
