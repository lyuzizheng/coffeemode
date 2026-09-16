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
    expect(parseAllowlistEntry("https://staging.cafemood.app:3000")).toEqual({
      host: "staging.cafemood.app:3000",
      hostname: "staging.cafemood.app",
    });
    expect(parseAllowlistEntry("//preview.example.com")).toEqual({
      host: "preview.example.com",
      hostname: "preview.example.com",
    });
    expect(parseAllowlistEntry("not-a-valid-host/with/path")).toBeNull();
  });

  it("honors NEXT_PUBLIC_ALLOWED_HOSTS and NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://cafemood.app";
    process.env.NEXT_PUBLIC_ALLOWED_HOSTS = "staging.cafemood.app, preview.cafemood.app:8080";

    const allowed = getAllowedHosts();
    expect(allowed.has("cafemood.app")).toBe(true);
    expect(allowed.has("staging.cafemood.app")).toBe(true);
    expect(allowed.has("preview.cafemood.app:8080")).toBe(true);
    expect(allowed.has("evil.com")).toBe(false);

    expect(isAllowedOrigin("https://staging.cafemood.app")).toBe(true);
    expect(isAllowedOrigin("https://preview.cafemood.app:8080")).toBe(true);
    expect(isAllowedOrigin("https://evil.com")).toBe(false);
  });

  it("ignores a forged x-forwarded-host: evil Origin + evil XFH is cross-origin (BRAWUKA-282 P1-1)", () => {
    const req = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: {
        host: "cafemood.app",
        "x-forwarded-host": "evil.com",
        origin: "https://evil.com",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
    expect(requireSameOrigin(req)?.status).toBe(403);
  });

  it("ignores x-forwarded-host when host itself matches (BRAWUKA-282 P1-1)", () => {
    const req = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: {
        host: "cafemood.app",
        "x-forwarded-host": "evil.com",
        origin: "https://cafemood.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects when Sec-Fetch-Site is cross-site", () => {
    const req = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: {
        host: "cafemood.app",
        "sec-fetch-site": "cross-site",
        origin: "https://evil.com",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts when Sec-Fetch-Site is same-origin and Origin matches Host", () => {
    const req = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: {
        host: "cafemood.app",
        "sec-fetch-site": "same-origin",
        origin: "https://cafemood.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects malformed Origin header", () => {
    const req = new Request("https://cafemood.app/api/cafes", {
      method: "POST",
      headers: {
        host: "cafemood.app",
        origin: "not-a-valid-url",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts when Origin is absent and no cross-site indicators exist", () => {
    const req = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: {
        host: "cafemood.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects mismatched Referer when Origin is absent", () => {
    const req = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: {
        host: "cafemood.app",
        referer: "https://attacker.org/phishing",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
  });

  it("accepts matching Referer when Origin is absent", () => {
    const req = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: {
        host: "cafemood.app",
        referer: "https://cafemood.app/cafes/123",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("requireSameOrigin returns null for same-origin and 403 response for cross-origin", () => {
    const okReq = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: { host: "cafemood.app", origin: "https://cafemood.app" },
    });
    expect(requireSameOrigin(okReq)).toBeNull();

    const badReq = new Request("https://cafemood.app/api/checkins", {
      method: "POST",
      headers: { host: "cafemood.app", origin: "https://attacker.evil" },
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
        host: "cafemood.app",
        "sec-fetch-site": "cross-site",
        origin: "https://attacker.evil",
      },
    });

  const dummyParams = { params: Promise.resolve({ id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" }) };

  it("POST /api/cafes rejects cross-origin", async () => {
    const res = await postCafe(crossSiteReq("https://cafemood.app/api/cafes", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("DELETE /api/cafes/[id] rejects cross-origin", async () => {
    const res = await deleteCafe(crossSiteReq("https://cafemood.app/api/cafes/1", "DELETE"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/checkins rejects cross-origin", async () => {
    const res = await postCheckin(crossSiteReq("https://cafemood.app/api/checkins", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("PATCH /api/checkins/[id] rejects cross-origin", async () => {
    const res = await patchCheckin(crossSiteReq("https://cafemood.app/api/checkins/1", "PATCH"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("DELETE /api/checkins/[id] rejects cross-origin", async () => {
    const res = await deleteCheckin(crossSiteReq("https://cafemood.app/api/checkins/1", "DELETE"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/checkins/[id]/like rejects cross-origin", async () => {
    const res = await postCheckinLike(crossSiteReq("https://cafemood.app/api/checkins/1/like", "POST"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/images/upload rejects cross-origin", async () => {
    const res = await postImageUpload(crossSiteReq("https://cafemood.app/api/images/upload", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/navigations rejects cross-origin", async () => {
    const res = await postNavigation(crossSiteReq("https://cafemood.app/api/navigations", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });
  it("PATCH /api/profile rejects cross-origin", async () => {
    const res = await patchProfile(crossSiteReq("https://cafemood.app/api/profile", "PATCH") as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/checkins rejects forged Origin + X-Forwarded-Host pair (BRAWUKA-282 P1-1 gate)", async () => {
    const res = await postCheckin(
      new Request("https://cafemood.app/api/checkins", {
        method: "POST",
        headers: {
          host: "cafemood.app",
          origin: "https://evil.com",
          "x-forwarded-host": "evil.com",
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/places/external rejects cross-origin", async () => {
    const res = await postPlacesExternal(crossSiteReq("https://cafemood.app/api/places/external", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });

  it("POST /api/places/resolve rejects cross-origin", async () => {
    const res = await postPlacesResolve(crossSiteReq("https://cafemood.app/api/places/resolve", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin", message: "cross-origin request forbidden" });
  });
});
