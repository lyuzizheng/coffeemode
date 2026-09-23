import { describe, expect, it } from "vitest";
import {
  assertAllowedUrl,
  isAccessHost,
  isAllowedHost,
  isAllowedUrl,
} from "../../../scripts/agent-qa/allowlist.mjs";

describe("isAllowedHost", () => {
  it("allows the app, image CDN, staging Supabase, and Access handshake hosts", () => {
    expect(isAllowedHost("staging.cafemood.app")).toBe(true);
    expect(isAllowedHost("staging-images.cafemood.app")).toBe(true);
    expect(isAllowedHost("ojujmjewtbquiddswyrg.supabase.co")).toBe(true);
    expect(isAllowedHost("foo.cloudflareaccess.com")).toBe(true);
  });

  it("never matches production, the bare Access suffix, or lookalikes", () => {
    expect(isAllowedHost("cafemood.app")).toBe(false);
    expect(isAllowedHost("www.cafemood.app")).toBe(false);
    expect(isAllowedHost("cloudflareaccess.com")).toBe(false);
    expect(isAllowedHost("staging.cafemood.app.evil.com")).toBe(false);
    expect(isAllowedHost("")).toBe(false);
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(isAllowedHost("Staging.CafeMood.App")).toBe(true);
    expect(isAllowedHost("staging.cafemood.app.")).toBe(true);
  });
});

describe("isAccessHost (BRAWUKA-593)", () => {
  it("covers only the Access-protected hosts, never the staging Supabase host", () => {
    expect(isAccessHost("staging.cafemood.app")).toBe(true);
    expect(isAccessHost("staging-images.cafemood.app")).toBe(true);
    expect(isAccessHost("foo.cloudflareaccess.com")).toBe(true);
    expect(isAccessHost("ojujmjewtbquiddswyrg.supabase.co")).toBe(false);
    expect(isAccessHost("cafemood.app")).toBe(false);
    expect(isAccessHost("")).toBe(false);
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(isAccessHost("Staging.CafeMood.App")).toBe(true);
    expect(isAccessHost("staging.cafemood.app.")).toBe(true);
  });
});

describe("isAllowedUrl / assertAllowedUrl", () => {
  it("accepts only http(s) URLs on allowed hosts", () => {
    expect(isAllowedUrl("https://staging.cafemood.app/auth/callback")).toBe(true);
    expect(isAllowedUrl("https://cafemood.app/")).toBe(false);
    expect(isAllowedUrl("ftp://staging.cafemood.app/x")).toBe(false);
    expect(isAllowedUrl("not a url")).toBe(false);
  });

  it("returns the URL unchanged when allowed, throws naming the host when not", () => {
    const url = "https://staging.cafemood.app/discover";
    expect(assertAllowedUrl(url)).toBe(url);
    expect(() => assertAllowedUrl("https://cafemood.app/")).toThrow(/cafemood\.app/);
  });
});
