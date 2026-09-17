import { describe, expect, it } from "vitest";
import {
  R2_ALLOWED_PUBLIC_HOSTS,
  R2_PUBLIC_HOST,
  R2_PUBLIC_HOST_PROD,
  R2_PUBLIC_HOST_STAGING,
  assertR2PublicUrlMatches,
  r2PublicUrl,
  resolveR2PublicHost,
} from "@/lib/images/constants";
import { isR2Image, r2ImageLoader } from "@/lib/images/loader";

describe("assertR2PublicUrlMatches", () => {
  it("returns undefined for unset env (no-op)", () => {
    expect(assertR2PublicUrlMatches(undefined)).toBeUndefined();
    expect(assertR2PublicUrlMatches("")).toBeUndefined();
  });
  it("exports R2_ALLOWED_PUBLIC_HOSTS and default R2_PUBLIC_HOST", () => {
    expect(R2_ALLOWED_PUBLIC_HOSTS).toContain(R2_PUBLIC_HOST_PROD);
    expect(R2_ALLOWED_PUBLIC_HOSTS).toContain(R2_PUBLIC_HOST_STAGING);
    expect(R2_PUBLIC_HOST).toBe(R2_PUBLIC_HOST_PROD);
  });


  it("parses matching host with or without scheme and path", () => {
    expect(assertR2PublicUrlMatches("https://images.cafemood.app")).toBe(R2_PUBLIC_HOST_PROD);
    expect(assertR2PublicUrlMatches("https://images.cafemood.app/base")).toBe(R2_PUBLIC_HOST_PROD);
    expect(assertR2PublicUrlMatches("images.cafemood.app")).toBe(R2_PUBLIC_HOST_PROD);
    expect(assertR2PublicUrlMatches("https://staging-images.cafemood.app")).toBe(
      R2_PUBLIC_HOST_STAGING,
    );
    expect(assertR2PublicUrlMatches("staging-images.cafemood.app/base")).toBe(
      R2_PUBLIC_HOST_STAGING,
    );
  });

  it("enforces staging host when APP_ENV=staging", () => {
    expect(assertR2PublicUrlMatches("https://staging-images.cafemood.app", "staging")).toBe(
      R2_PUBLIC_HOST_STAGING,
    );
    expect(() => assertR2PublicUrlMatches("https://images.cafemood.app", "staging")).toThrow(
      /does not match staging R2 host/,
    );
  });

  it("enforces production host when APP_ENV=production", () => {
    expect(assertR2PublicUrlMatches("https://images.cafemood.app", "production")).toBe(
      R2_PUBLIC_HOST_PROD,
    );
    expect(() =>
      assertR2PublicUrlMatches("https://staging-images.cafemood.app", "production"),
    ).toThrow(/does not match production R2 host/);
  });

  it("throws on a drifted host", () => {
    expect(() => assertR2PublicUrlMatches("https://cdn.example.com")).toThrow(/does not match/);
  });

  it("throws on garbage values", () => {
    expect(() => assertR2PublicUrlMatches("http://[")).toThrow(/Invalid NEXT_PUBLIC_R2_PUBLIC_URL/);
  });

  it("constructs canonical public CDN URLs via r2PublicUrl", () => {
    expect(r2PublicUrl("avatars/user.webp")).toBe("https://images.cafemood.app/avatars/user.webp");
    expect(r2PublicUrl("/avatars/user.webp")).toBe("https://images.cafemood.app/avatars/user.webp");
    expect(r2PublicUrl("avatars/user.webp", R2_PUBLIC_HOST_STAGING)).toBe(
      "https://staging-images.cafemood.app/avatars/user.webp",
    );
  });

  it("resolves R2 public host based on explicit URL or APP_ENV", () => {
    expect(resolveR2PublicHost()).toBe(R2_PUBLIC_HOST_PROD);
    expect(resolveR2PublicHost("https://staging-images.cafemood.app")).toBe(
      R2_PUBLIC_HOST_STAGING,
    );
    expect(resolveR2PublicHost(undefined, "staging")).toBe(R2_PUBLIC_HOST_STAGING);
    expect(resolveR2PublicHost(undefined, "production")).toBe(R2_PUBLIC_HOST_PROD);
  });
});
describe("r2ImageLoader / isR2Image", () => {
  it("maps relative keys onto the CDN host", () => {
    expect(r2ImageLoader({ src: "abc/card.webp", width: 800, quality: 75 })).toBe(
      "https://images.cafemood.app/abc/card.webp",
    );
    expect(r2ImageLoader({ src: "/abc/card.webp", width: 800, quality: 75 })).toBe(
      "https://images.cafemood.app/abc/card.webp",
    );
  });

  it("passes absolute URLs through unchanged", () => {
    expect(
      r2ImageLoader({ src: "https://images.cafemood.app/x/card.webp", width: 800, quality: 75 }),
    ).toBe("https://images.cafemood.app/x/card.webp");
    expect(r2ImageLoader({ src: "https://other.example.com/y.webp", width: 800, quality: 75 })).toBe(
      "https://other.example.com/y.webp",
    );
  });

  it("isR2Image matches only the CDN hosts, with a path boundary", () => {
    expect(isR2Image("https://images.cafemood.app/a.webp")).toBe(true);
    expect(isR2Image("https://images.cafemood.app")).toBe(true); // bare host via URL fallback
    expect(isR2Image("https://staging-images.cafemood.app/a.webp")).toBe(true);
    expect(isR2Image("https://staging-images.cafemood.app")).toBe(true);
    expect(isR2Image("https://images.cafemood.app.evil.com/a.webp")).toBe(false);
    expect(isR2Image("https://staging-images.cafemood.app.evil.com/a.webp")).toBe(false);
    expect(isR2Image("evil-images.cafemood.app/a.webp")).toBe(false);
    expect(isR2Image("https://example.com/a.webp")).toBe(false);
    expect(isR2Image("notaurl")).toBe(false);
  });
});

