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

    const getUser = vi.fn(async () => {
      capturedSetAll?.([
        { name: "sb-access-token", value: "fresh-token", options: {} },
      ]);
      return { data: { user: { id: "u1" } }, error: null };
    });

    vi.mocked(createServerClient).mockImplementation(
      (_url: string, _key: string, options: unknown) => {
        const opts = options as { cookies: { setAll?: (cookiesToSet: unknown[]) => void } };
        capturedSetAll = opts.cookies.setAll;
        return { auth: { getUser } } as unknown as ReturnType<typeof createServerClient>;
      },
    );

    const req = new NextRequest(new URL("http://localhost/cafes/c1"), {
      headers: new Headers(),
    });
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);

    expect(getUser).toHaveBeenCalledTimes(1);
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
});
