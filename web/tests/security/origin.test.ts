import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/lib/security/origin";

describe("isSameOrigin validation", () => {
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

  it("accepts matching x-forwarded-host behind proxy", () => {
    const req = new Request("https://localhost/api/checkins", {
      method: "POST",
      headers: {
        host: "internal-service",
        "x-forwarded-host": "coffeemode.app",
        origin: "https://coffeemode.app",
      },
    });
    expect(isSameOrigin(req)).toBe(true);
  });

  it("rejects when Origin does not match Host or x-forwarded-host", () => {
    const req = new Request("https://coffeemode.app/api/cafes", {
      method: "POST",
      headers: {
        host: "coffeemode.app",
        origin: "https://malicious-site.com",
      },
    });
    expect(isSameOrigin(req)).toBe(false);
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
});

import { POST as postCafe } from "@/app/api/cafes/route";
import { POST as postCheckin } from "@/app/api/checkins/route";
import { PATCH as patchCheckin, DELETE as deleteCheckin } from "@/app/api/checkins/[id]/route";
import { POST as postCheckinLike } from "@/app/api/checkins/[id]/like/route";
import { POST as postImageComplete } from "@/app/api/images/complete/route";
import { POST as postImageUpload } from "@/app/api/images/upload/route";
import { POST as postNavigation } from "@/app/api/navigations/route";
import { POST as postPlacesExternal } from "@/app/api/places/external/route";
import { POST as postPlacesResolve } from "@/app/api/places/resolve/route";
import { PATCH as patchProfile } from "@/app/api/profile/route";

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
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/checkins rejects cross-origin", async () => {
    const res = await postCheckin(crossSiteReq("https://coffeemode.app/api/checkins", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("PATCH /api/checkins/[id] rejects cross-origin", async () => {
    const res = await patchCheckin(crossSiteReq("https://coffeemode.app/api/checkins/1", "PATCH"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("DELETE /api/checkins/[id] rejects cross-origin", async () => {
    const res = await deleteCheckin(crossSiteReq("https://coffeemode.app/api/checkins/1", "DELETE"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/checkins/[id]/like rejects cross-origin", async () => {
    const res = await postCheckinLike(crossSiteReq("https://coffeemode.app/api/checkins/1/like", "POST"), dummyParams);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/images/complete rejects cross-origin", async () => {
    const res = await postImageComplete(crossSiteReq("https://coffeemode.app/api/images/complete", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/images/upload rejects cross-origin", async () => {
    const res = await postImageUpload(crossSiteReq("https://coffeemode.app/api/images/upload", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/navigations rejects cross-origin", async () => {
    const res = await postNavigation(crossSiteReq("https://coffeemode.app/api/navigations", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/places/external rejects cross-origin", async () => {
    const res = await postPlacesExternal(crossSiteReq("https://coffeemode.app/api/places/external", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("POST /api/places/resolve rejects cross-origin", async () => {
    const res = await postPlacesResolve(crossSiteReq("https://coffeemode.app/api/places/resolve", "POST"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("PATCH /api/profile rejects cross-origin", async () => {
    const res = await patchProfile(crossSiteReq("https://coffeemode.app/api/profile", "PATCH") as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });
});
