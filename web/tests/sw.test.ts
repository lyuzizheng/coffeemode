import { describe, expect, it } from "vitest";
import { RUNTIME_RULES, SW_URL } from "@/lib/sw-rules";

/**
 * Table-test the service-worker routing policy the way tests/proxy.test.ts
 * tests the proxy matcher (review 2026-08-09 F4/C3). Every pathname/host
 * below is a route that exists today; a matcher that accidentally swallows
 * a route it should not would fail here, not in production.
 */
function urlFor(pathname: string, host = "localhost"): URL {
  return new URL(pathname, `https://${host}`);
}

describe("sw runtime rules", () => {
  it("has exactly one rule per route family and all are GET", () => {
    expect(RUNTIME_RULES.length).toBe(11);
    for (const rule of RUNTIME_RULES) {
      expect(rule.method).toBe("GET");
      expect(rule.name).toBeTruthy();
    }
  });

  it("never caches the home page, the worker, the manifest, auth, any API route, or user-specific pages", () => {
    const networkOnly = RUNTIME_RULES.filter((r) => r.handler === "network-only").map(
      (r) => r.name,
    );
    expect(networkOnly).toEqual(["home", "sw-manifest", "auth", "cafes", "api", "profile", "settings", "search"]);
  });

  it("matches each route family to the intended handler", () => {
    const cases: Array<{
      name: string;
      pathname: string;
      host?: string;
      matches: string[];
      notMatches: string[];
    }> = [
      {
        name: "home",
        pathname: "/",
        matches: ["home"],
        notMatches: ["sw-manifest", "auth", "api", "r2-images", "next-static", "static-assets"],
      },
      {
        name: "sw-manifest",
        pathname: SW_URL,
        matches: ["sw-manifest"],
        notMatches: ["home"],
      },
      {
        name: "sw-manifest (manifest)",
        pathname: "/manifest.webmanifest",
        matches: ["sw-manifest"],
        notMatches: ["home"],
      },
      {
        name: "auth",
        pathname: "/auth/callback",
        matches: ["auth"],
        notMatches: ["sw-manifest", "api"],
      },
      {
        name: "images upload",
        pathname: "/api/images/upload",
        matches: ["api"],
        notMatches: ["auth"],
      },
      {
        name: "health",
        pathname: "/api/health",
        matches: ["api"],
        notMatches: ["auth"],
      },
      {
        name: "places proxy",
        pathname: "/api/places/0x123",
        matches: ["api"],
        notMatches: ["auth"],
      },
      {
        name: "cafes nearby (issue #45 route)",
        pathname: "/api/cafes",
        matches: ["api"],
        notMatches: ["auth"],
      },
      {
        name: "cafe detail (issue #45 route)",
        pathname: "/api/cafes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        matches: ["api"],
        notMatches: ["auth"],
      },
      {
        name: "cafe page (BRAWUKA-638: must be network-only, never defaultCache)",
        pathname: "/cafes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        matches: ["cafes"],
        notMatches: ["api", "auth"],
      },
      {
        name: "cafe og-image (BRAWUKA-638: nested page asset)",
        pathname: "/cafes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/og-image",
        matches: ["cafes"],
        notMatches: ["api", "auth"],
      },
      {
        name: "navigations (issue #45 route)",
        pathname: "/api/navigations",
        matches: ["api"],
        notMatches: ["auth"],
      },
      {
        name: "profile (BRAWUKA-662: must be network-only, never defaultCache)",
        pathname: "/profile",
        matches: ["profile"],
        notMatches: ["api", "auth"],
      },
      {
        name: "settings (BRAWUKA-662: must be network-only, never defaultCache)",
        pathname: "/settings",
        matches: ["settings"],
        notMatches: ["api", "auth"],
      },
      {
        name: "search (BRAWUKA-662: must be network-only, never defaultCache)",
        pathname: "/search",
        matches: ["search"],
        notMatches: ["api", "auth"],
      },
      {
        name: "r2 images (by host)",
        pathname: "/variants/abc.webp",
        host: "images.cafemood.app",
        matches: ["r2-images"],
        notMatches: ["next-static", "static-assets"],
      },
      {
        name: "r2 staging images (by host)",
        pathname: "/variants/abc.webp",
        host: "staging-images.cafemood.app",
        matches: ["r2-images"],
        notMatches: ["next-static", "static-assets"],
      },
      {
        name: "next static",
        pathname: "/_next/static/chunks/x.js",
        matches: ["next-static"],
        notMatches: ["static-assets", "r2-images"],
      },
      {
        name: "icons",
        pathname: "/icons/icon-192.png",
        matches: ["static-assets"],
        notMatches: ["next-static"],
      },
      {
        name: "fonts",
        pathname: "/fonts/Inter.woff2",
        matches: ["static-assets"],
        notMatches: ["next-static"],
      },
    ];

    for (const c of cases) {
      const url = urlFor(c.pathname, c.host);
      const request = new Request(url);
      const matched = RUNTIME_RULES.filter((rule) => rule.matcher({ url, request })).map(
        (rule) => rule.name,
      );
      expect(matched, `${c.name} matched ${matched.join(",")}`).toEqual(c.matches);
      for (const excluded of c.notMatches) {
        expect(matched, `${c.name} must not match ${excluded}`).not.toContain(excluded);
      }
    }
  });

  it("guards every /api/* path with network-only (issue #46: defaultCache has a 24h NetworkFirst 'apis' catch-all)", () => {
    const api = [
      "/api/cafes",
      "/api/cafes/",
      "/api/checkins/",
      "/api/navigations",
      "/api/navigations/prompt",
      "/api/navigations/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44/resolve",
    ];
    const apiRule = RUNTIME_RULES.find((r) => r.name === "api");
    expect(apiRule?.handler).toBe("network-only");
    for (const path of api) {
      const url = urlFor(path);
      const request = new Request(url);
      const matched = RUNTIME_RULES.filter((rule) => rule.matcher({ url, request })).map(
        (rule) => rule.name,
      );
      expect(matched, `${path} must match only the api rule`).toEqual(["api"]);
    }
  });
  it("guards user-specific pages with network-only (BRAWUKA-662: defaultCache has 24h NetworkFirst pages/pages-rsc/others catch-alls)", () => {
    const pages: Array<{ path: string; rule: string }> = [
      { path: "/profile", rule: "profile" },
      { path: "/settings", rule: "settings" },
      { path: "/search", rule: "search" },
      { path: "/search?q=latte&city=taipei", rule: "search" },
    ];
    for (const { path, rule } of pages) {
      const found = RUNTIME_RULES.find((r) => r.name === rule);
      expect(found?.handler, rule).toBe("network-only");
      const url = urlFor(path);
      const request = new Request(url);
      const matched = RUNTIME_RULES.filter((r) => r.matcher({ url, request })).map(
        (r) => r.name,
      );
      expect(matched, `${path} must match only the ${rule} rule`).toEqual([rule]);
    }
  });

  it("guards every /cafes/:id page with network-only (BRAWUKA-638: defaultCache has 24h NetworkFirst pages/pages-rsc/others catch-alls)", () => {
    const pages = [
      "/cafes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      "/cafes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22/og-image",
    ];
    const cafesRule = RUNTIME_RULES.find((r) => r.name === "cafes");
    expect(cafesRule?.handler).toBe("network-only");
    for (const path of pages) {
      const url = urlFor(path);
      const request = new Request(url);
      const matched = RUNTIME_RULES.filter((rule) => rule.matcher({ url, request })).map(
        (rule) => rule.name,
      );
      expect(matched, `${path} must match only the cafes rule`).toEqual(["cafes"]);
    }
  });

  it("does not reference routes that do not exist yet", () => {
    const dead = ["/cafes/"];
    for (const path of dead) {
      const url = urlFor(path);
      const request = new Request(url);
      const hit = RUNTIME_RULES.some((rule) => rule.matcher({ url, request }));
      expect(hit, `${path} must not match any rule`).toBe(false);
    }
  });

  it("caches immutable assets with cache-first and a bounded cache", () => {
    for (const name of ["r2-images", "next-static", "static-assets"]) {
      const rule = RUNTIME_RULES.find((r) => r.name === name);
      expect(rule?.handler, name).toBe("cache-first");
      expect(rule?.cache?.cacheName, name).toBeTruthy();
      expect(rule?.cache?.maxEntries, name).toBeGreaterThan(0);
    }
  });
});
