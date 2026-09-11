import { describe, expect, it } from "vitest";
import { assertR2PublicUrlMatches, R2_PUBLIC_HOST, r2PublicUrl } from "@/lib/images/constants";
import { isR2Image, r2ImageLoader } from "@/lib/images/loader";

describe("assertR2PublicUrlMatches", () => {
  it("returns undefined for unset env (no-op)", () => {
    expect(assertR2PublicUrlMatches(undefined)).toBeUndefined();
    expect(assertR2PublicUrlMatches("")).toBeUndefined();
  });

  it("parses matching host with or without scheme and path", () => {
    expect(assertR2PublicUrlMatches("https://images.coffeemode.app")).toBe(R2_PUBLIC_HOST);
    expect(assertR2PublicUrlMatches("https://images.coffeemode.app/base")).toBe(R2_PUBLIC_HOST);
    expect(assertR2PublicUrlMatches("images.coffeemode.app")).toBe(R2_PUBLIC_HOST);
  });
  it("throws on a drifted host", () => {
    expect(() => assertR2PublicUrlMatches("https://cdn.example.com")).toThrow(/does not match/);
  });

  it("throws on garbage values", () => {
    expect(() => assertR2PublicUrlMatches("http://[")).toThrow(/Invalid NEXT_PUBLIC_R2_PUBLIC_URL/);
  });

  it("constructs canonical public CDN URLs via r2PublicUrl", () => {
    expect(r2PublicUrl("avatars/user.webp")).toBe("https://images.coffeemode.app/avatars/user.webp");
    expect(r2PublicUrl("/avatars/user.webp")).toBe("https://images.coffeemode.app/avatars/user.webp");
  });
});
describe("r2ImageLoader / isR2Image", () => {
  it("maps relative keys onto the CDN host", () => {
    expect(r2ImageLoader({ src: "abc/card.webp", width: 800, quality: 75 })).toBe(
      "https://images.coffeemode.app/abc/card.webp",
    );
    expect(r2ImageLoader({ src: "/abc/card.webp", width: 800, quality: 75 })).toBe(
      "https://images.coffeemode.app/abc/card.webp",
    );
  });

  it("passes absolute URLs through unchanged", () => {
    expect(
      r2ImageLoader({ src: "https://images.coffeemode.app/x/card.webp", width: 800, quality: 75 }),
    ).toBe("https://images.coffeemode.app/x/card.webp");
    expect(r2ImageLoader({ src: "https://other.example.com/y.webp", width: 800, quality: 75 })).toBe(
      "https://other.example.com/y.webp",
    );
  });

  it("isR2Image matches only the CDN host, with a path boundary", () => {
    expect(isR2Image("https://images.coffeemode.app/a.webp")).toBe(true);
    expect(isR2Image("https://images.coffeemode.app")).toBe(true); // bare host via URL fallback
    expect(isR2Image("https://images.coffeemode.app.evil.com/a.webp")).toBe(false);
    expect(isR2Image("evil-images.coffeemode.app/a.webp")).toBe(false);
    expect(isR2Image("https://example.com/a.webp")).toBe(false);
    expect(isR2Image("notaurl")).toBe(false);
  });
});

