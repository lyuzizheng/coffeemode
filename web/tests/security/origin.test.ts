import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getAllowedHosts,
  isAllowedOrigin,
  isSameOrigin,
  parseAllowlistEntry,
  requireSameOrigin,
} from "@/lib/security/origin";

import { POST as postCafe } from "@/app/api/cafes/route";
import { DELETE as deleteCafe } from "@/app/api/cafes/[id]/route";
import { POST as postCheckin } from "@/app/api/checkins/route";
import { PATCH as patchCheckin, DELETE as deleteCheckin } from "@/app/api/checkins/[id]/route";
import { POST as postCheckinLike } from "@/app/api/checkins/[id]/like/route";
import { POST as postImageComplete } from "@/app/api/images/complete/route";
import { POST as postImageUpload } from "@/app/api/images/upload/route";
import { POST as postNavigation } from "@/app/api/navigations/route";
import { POST as postPlacesExternal } from "@/app/api/places/external/route";
import { POST as postPlacesResolve } from "@/app/api/places/resolve/route";
import { PATCH as patchProfile } from "@/app/api/profile/route";

describe("isSameOrigin and allowlist unification", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_ALLOWED_HOSTS;
  });

  it("parses allowlist entries correctly", () => {
    expect(parseAllowlistEntry("https://staging.coffeemode.app:3000")).toEqual({
      host: "staging.coffeemode.app:3000",
      hostname: "staging.coffeemode.app",
    });
    expect(parseAllowlistEntry("//preview.example.com")).toEqual({
      host: "preview.example.com",
      hostname: "preview.example.com",
    });
    expect(parseAllowlistEntry("not-a-valid-host/with/path")).toBeNull();
  });

  it("honors NEXT_PUBLIC_ALLOWED_HOSTS and NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://coffeemode.app";
    process.env.NEXT_PUBLIC_ALLOWED_HOSTS = "staging.coffeemode.app, preview.coffeemode.app:8080";

    const allowed = getAllowedHosts();
    expect(allowed.has("coffeemode.app")).toBe(true);
    expect(allowed.has("staging.coffeemode.app")).toBe(true);
    expect(allowed.has("preview.coffeemode.app:8080")).toBe(true);
    expect(allowed.has("evil.com")).toBe(false);

    expect(isAllowedOrigin("https://staging.coffeemode.app")).toBe(true);
    expect(isAllowedOrigin("https://preview.coffeemode.app:8080")).toBe(true);
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
  });

  it("handles comma-separated x-forwarded-host from reverse proxies", () => {
    const req = new Request("https://internal-alb/api/checkins", {
      method: "POST",
      headers: {
        host: "internal-alb",
        "x-forwarded-host": "coffeemode.app, proxy.aws.internal",
        origin: "https://coffeemode.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects when Sec-Fetch-Site is cross-site", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        "sec-fetch-site": "cross-site",
        origin: "https://evil.com",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts when Sec-Fetch-Site is same-origin and Origin matches Host", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        "sec-fetch-site": "same-origin",
        origin: "https://coffeemode.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects malformed Origin header", () => {
    const req = new Request("https://coffeemode.app/api/cafes", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        origin: "not-a-valid-url",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts when Origin is absent and no cross-site indicators exist", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects mismatched Referer when Origin is absent", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        referer: "https://attacker.org/phishing",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts matching Referer when Origin is absent", () => {
    const req = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        referer: "https://coffeemode.app/cafes/123",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("requireSameOrigin returns null for same-origin and 403 response for cross-origin", () => {
    const okReq = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: { host: "coffeemode.app", origin: "https://coffeemode.app" },
    });
    expect(requireSameOrigin(okReq)).toBeNull();

    const badReq = new Request("https://coffeemode.app/api/checkins", {
      method: "POST",
      headers: { host: "coffeemode.app", origin: "https://attacker.evil" },
    });
    const errorRes = requireSameOrigin(badReq);
    expect(errorRes).not.toBeNull();
    expect(errorRes?.status).toBe(403);
  });
});

describe("mutating API routes reject cross-site requests at the boundary", () => {
  const crossSiteReq = (url: string, method: string) =>
    new Request(url, {
      method,
      headers: {
        host: "coffeemode.app",
        "sec-fetch-site": "cross-site",
        origin: "https://attacker.evil",
      },
    });

  const dummyParams = { params: Promise.resolve({ id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" }) };

  it("POST /api/cafes rejects cross-origin", async () => {
    const res = await postCafe(crossSiteReq("https://coffeemode.app/api/cafes", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("DELETE /api/cafes/[id] rejects cross-origin", async () => {
    const res = await deleteCafe(crossSiteReq("https://coffeemode.app/api/cafes/1", "DELETE"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/checkins rejects cross-origin", async () => {
    const res = await postCheckin(crossSiteReq("https://coffeemode.app/api/checkins", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("PATCH /api/checkins/[id] rejects cross-origin", async () => {
    const res = await patchCheckin(crossSiteReq("https://coffeemode.app/api/checkins/1", "PATCH"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("DELETE /api/checkins/[id] rejects cross-origin", async () => {
    const res = await deleteCheckin(crossSiteReq("https://coffeemode.app/api/checkins/1", "DELETE"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/checkins/[id]/like rejects cross-origin", async () => {
    const res = await postCheckinLike(crossSiteReq("https://coffeemode.app/api/checkins/1/like", "POST"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/images/complete rejects cross-origin", async () => {
    const res = await postImageComplete(crossSiteReq("https://coffeemode.app/api/images/complete", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/images/upload rejects cross-origin", async () => {
    const res = await postImageUpload(crossSiteReq("https://coffeemode.app/api/images/upload", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/navigations rejects cross-origin", async () => {
    const res = await postNavigation(crossSiteReq("https://coffeemode.app/api/navigations", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/places/external rejects cross-origin", async () => {
    const res = await postPlacesExternal(crossSiteReq("https://coffeemode.app/api/places/external", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/places/resolve rejects cross-origin", async () => {
    const res = await postPlacesResolve(crossSiteReq("https://coffeemode.app/api/places/resolve", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("PATCH /api/profile rejects cross-origin", async () => {
    const res = await patchProfile(crossSiteReq("https://coffeemode.app/api/profile", "PATCH") as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });
});

describe("structural enforcement: all mutating API routes require same-origin protection", () => {
  function findRouteFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findRouteFiles(fullPath));
      } else if (entry.name === "route.ts") {
        results.push(fullPath);
      }
    }
    return results;
  }

  it("every route handler exporting POST, PATCH, PUT, or DELETE invokes requireSameOrigin", () => {
    const apiDir = path.resolve(__dirname, "../../app/api");
    const routeFiles = findRouteFiles(apiDir);
    const mutatingMethodRegex = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/;

    const unguardedRoutes: string[] = [];
    for (const file of routeFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (mutatingMethodRegex.test(content)) {
        if (!content.includes("requireSameOrigin")) {
          unguardedRoutes.push(path.relative(apiDir, file));
        }
      }
    }

    expect(unguardedRoutes).toEqual([]);
  });
});
