import { describe, expect, it, vi } from "vitest";
import {
  fetchRuntimeConfig,
  isBannerKind,
  isBannerLive,
  isRuntimeBanner,
  pickBannerText,
  selectLiveBanner,
} from "@/lib/runtime-banners";

describe("runtime banner guards (BRAWUKA-284)", () => {
  it("accepts the four manifesto kinds and rejects promos", () => {
    expect(isBannerKind("maintenance")).toBe(true);
    expect(isBannerKind("outage")).toBe(true);
    expect(isBannerKind("feature")).toBe(true);
    expect(isBannerKind("editorial")).toBe(true);
    expect(isBannerKind("promo")).toBe(false);
    expect(isBannerKind("upsell")).toBe(false);
    expect(isBannerKind(undefined)).toBe(false);
  });

  it("rejects malformed banners instead of crashing the shell", () => {
    expect(isRuntimeBanner(null)).toBe(false);
    expect(isRuntimeBanner({ id: "", kind: "outage", text: { en: "x" } })).toBe(false);
    expect(isRuntimeBanner({ id: "a", kind: "promo", text: { en: "x" } })).toBe(false);
    expect(isRuntimeBanner({ id: "a", kind: "outage", text: "x" })).toBe(false);
    expect(
      isRuntimeBanner({ id: "a", kind: "outage", text: { en: "ok" }, href: 42 }),
    ).toBe(false);
    expect(
      isRuntimeBanner({ id: "a", kind: "outage", text: { en: "ok" } }),
    ).toBe(true);
  });

  it("drops expired banners and keeps undated ones", () => {
    const live = { id: "a", kind: "outage", text: { en: "x" } } as const;
    expect(isBannerLive({ ...live })).toBe(true);
    expect(
      isBannerLive({ ...live, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    ).toBe(true);
    expect(
      isBannerLive({ ...live, expiresAt: new Date(Date.now() - 60_000).toISOString() }),
    ).toBe(false);
  });

  it("selects the first live banner from an untrusted payload", () => {
    const expired = {
      id: "old",
      kind: "outage",
      text: { en: "old" },
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const fresh = { id: "new", kind: "feature", text: { en: "new" } };
    expect(selectLiveBanner([expired, fresh])).toEqual(fresh);
    expect(selectLiveBanner([expired])).toBeNull();
    expect(selectLiveBanner({ banners: [fresh] })).toBeNull();
  });

  it("localizes with en fallback", () => {
    const banner = { id: "a", kind: "feature", text: { en: "New", zh: "上新" } } as const;
    expect(pickBannerText({ ...banner }, "zh")).toBe("上新");
    expect(pickBannerText({ ...banner }, "fr")).toBe("New");
  });

  it("degrades to null when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    try {
      await expect(fetchRuntimeConfig()).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
