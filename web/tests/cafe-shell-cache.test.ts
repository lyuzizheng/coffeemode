import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CAFE_SHELL_BYPASS_CACHE_CONTROL,
  cafeShellCacheControl,
  cafeShellCdnRules,
  shouldBypassCafeShellCache,
} from "@/lib/cache-policy";
import { appConfig, parseAppConfig } from "@/lib/config";
import { proxy } from "@/proxy";

const SUPABASE_URL = "https://test.supabase.co";
const ANON_KEY = "test-anon-key";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

const cafeExistsMock = vi.fn<(id: string, userId?: string | null) => Promise<boolean>>(
  async () => true,
);
vi.mock("@/lib/db/cafes", () => ({
  cafeExists: (id: string, userId?: string | null) => cafeExistsMock(id, userId),
}));

import { createServerClient } from "@supabase/ssr";

// BRAWUKA-184: the /cafes/:id* cache contract is executable config, not a
// comment. These tests pin the three response classes: a plain shell stays
// cacheable, a session-refresh (Set-Cookie) response bypasses, and the
// gone-cafe 404 bypasses.

describe("cafe shell cache policy (single source)", () => {
  it("emits the static public header from app.yaml TTLs", () => {
    expect(cafeShellCacheControl(appConfig.seo.shellCache)).toBe(
      "public, s-maxage=600, stale-while-revalidate=3600",
    );
  });

  it("keeps the cacheable case cacheable", () => {
    expect(
      shouldBypassCafeShellCache(appConfig.seo.shellCache, {
        status: 200,
        setCookiePresent: false,
      }),
    ).toBe(false);
  });

  it("bypasses Set-Cookie responses and non-cacheable statuses", () => {
    const policy = appConfig.seo.shellCache;
    expect(
      shouldBypassCafeShellCache(policy, { status: 200, setCookiePresent: true }),
    ).toBe(true);
    expect(
      shouldBypassCafeShellCache(policy, { status: 404, setCookiePresent: false }),
    ).toBe(true);
    expect(
      shouldBypassCafeShellCache(policy, { status: 500, setCookiePresent: false }),
    ).toBe(true);
  });

  it("declares locales uncacheable across each other (DG110)", () => {
    expect(appConfig.seo.shellCache.sharedCacheAcrossLocales).toBe(false);
    expect(appConfig.seo.shellCache.varyHeaders).toContain("Accept-Language");
  });

  it("rejects an empty cacheableStatuses list", () => {
    expect(() =>
      parseAppConfig({
        ...minimalValid(),
        seo: {
          recoveryLimit: 5,
          shellCache: { ...minimalValid().seo.shellCache, cacheableStatuses: [] },
        },
      }),
    ).toThrow(/cacheableStatuses.*non-empty list of HTTP status codes/);
  });

  it("rejects a non-boolean bypass flag", () => {
    expect(() =>
      parseAppConfig({
        ...minimalValid(),
        seo: {
          recoveryLimit: 5,
          shellCache: {
            ...minimalValid().seo.shellCache,
            bypassOnSetCookieResponse: "yes",
          },
        },
      }),
    ).toThrow(/bypassOnSetCookieResponse.*must be a boolean/);
  });
});

describe("deploy edge rule (drift pin)", () => {
  it("matches the checked-in deploy/dokploy/cache-rules.json", () => {
    const file = path.join(process.cwd(), "..", "deploy", "dokploy", "cache-rules.json");
    const checkedIn = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const { $note, ...rest } = checkedIn;
    expect($note).toMatch(/BRAWUKA-184/);
    expect(rest).toEqual(cafeShellCdnRules(appConfig.seo.shellCache));
  });
});

describe("proxy cafe-shell cache classes", () => {
  const CAFE = "550e8400-e29b-41d4-a716-446655440001";

  beforeEach(() => {
    vi.resetAllMocks();
    cafeExistsMock.mockResolvedValue(true);
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  });

  it("leaves the anonymous shell untouched (static public header governs)", async () => {
    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`), {
      headers: new Headers(),
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("stamps no-store on a session-refresh response carrying Set-Cookie", async () => {
    let capturedSetAll: ((cookiesToSet: unknown[]) => void) | undefined;
    const getSession = vi.fn(async () => {
      capturedSetAll?.([
        { name: "sb-access-token", value: "fresh-token", options: {} },
      ]);
      return { data: { session: { user: { id: "u1" } } }, error: null };
    });
    vi.mocked(createServerClient).mockImplementation(
      (_url: string, _key: string, options: unknown) => {
        const opts = options as { cookies: { setAll?: (c: unknown[]) => void } };
        capturedSetAll = opts.cookies.setAll;
        return { auth: { getSession } } as unknown as SupabaseClient;
      },
    );

    const req = new NextRequest(new URL(`http://localhost/cafes/${CAFE}`), {
      headers: new Headers(),
    });
    req.cookies.set("sb-access-token", "stale-token");

    const res = await proxy(req);
    expect(res.cookies.get("sb-access-token")?.value).toBe("fresh-token");
    expect(res.headers.get("cache-control")).toBe(CAFE_SHELL_BYPASS_CACHE_CONTROL);
  });

  it("stamps no-store on the gone-cafe 404 rewrite", async () => {
    cafeExistsMock.mockResolvedValue(false);
    const req = new NextRequest(new URL("http://localhost/cafes/definitely-not-a-cafe"), {
      headers: new Headers(),
    });
    const res = await proxy(req);
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://localhost/__gone-cafe");
    expect(res.headers.get("cache-control")).toBe(CAFE_SHELL_BYPASS_CACHE_CONTROL);
  });
});

// Minimal valid app.yaml shape for the negative parse tests (mirrors
// tests/config.test.ts valid fixtures plus the BRAWUKA-184 bypass fields).
function minimalValid() {
  return {
    search: {
      maxRadiusKm: 10,
      defaultSuggestionLimit: 10,
      maxSuggestionLimit: 10,
      weakResultsThreshold: 3,
      dbFetchCap: 100,
      maxIterativeFetchBatches: 10,
      minPoiQueryLength: 3,
      relevanceWeights: { exactNameMatch: 100, prefixMatch: 80, fuzzyMatch: 50, secondaryMatch: 10 },
    },
    stats: {
      dimWeights: { wifi: 0.3, outlets: 0.2, seats: 0.2, temp: 0.15, coffee: 0.15 },
      recencyDecay: 0.6,
    },
    cafes: { listLimitMax: 50 },
    feed: { pageSize: 20 },
    discovery: { defaultCenter: { lat: 1.35, lng: 103.8 } },
    seo: {
      shellCache: {
        sMaxAgeSeconds: 600,
        staleWhileRevalidateSeconds: 3600,
        cacheableStatuses: [200],
        bypassOnSetCookieResponse: true,
        bypassOnRequestCookiePrefixes: ["sb-"],
        varyHeaders: ["Accept-Language"],
        sharedCacheAcrossLocales: false,
      },
      recoveryLimit: 5,
    },
    checkins: { photoCap: 6, noteMaxChars: 500, pendingDraftTtlHours: 72, revisitWindowHours: 24 },
    profile: { listLimitMax: 50, listPageSize: 20, displayNameMaxChars: 24, recentSearchesMax: 20 },
    budgets: {
      bundle: { maxJsChunkBytes: 409600, maxCssChunkBytes: 512000, maxTotalStaticBytes: 5242880 },
      lighthouse: { performance: 0.8, accessibility: 0.85, bestPractices: 0.85, seo: 0.85 },
    },
  };
}
