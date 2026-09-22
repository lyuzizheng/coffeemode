import { describe, expect, it } from "vitest";
import {
  PERMISSIONS_POLICY,
  contentSecurityPolicy,
  securityHeaders,
} from "@/lib/security/headers";

/**
 * BRAWUKA-633: the baseline CSP + Permissions-Policy contract is executable
 * config, not a comment. These tests pin the directives that must survive
 * every response: no `unsafe-eval`, no wildcard sources, geolocation granted
 * (onboarding locate), camera/mic/payment denied.
 */
describe("baseline security headers", () => {
  it("grants default-src 'self' with the required external exceptions", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("default-src 'self'");
    // MapKit SDK + Turnstile scripts must load.
    expect(csp).toContain("https://cdn.apple-mapkit.com");
    expect(csp).toContain("https://challenges.cloudflare.com");
    // MapLibre tiles + glyphs must connect.
    expect(csp).toContain("https://tiles.openfreemap.org");
    // MapKit JS search results fetch from Apple's API host.
    expect(csp).toContain("https://maps-api.apple.com");
  });

  it("never grants unsafe-eval or wildcard sources", () => {
    for (const csp of [contentSecurityPolicy(false), contentSecurityPolicy(true)]) {
      expect(csp).not.toContain("unsafe-eval");
      expect(csp).not.toMatch(/(^|\s)\*(;|\s|$)/);
    }
  });

  it("closes plugin/form/frame exfiltration", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("gates upgrade-insecure-requests on production only", () => {
    expect(contentSecurityPolicy(false)).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy(true)).toContain("upgrade-insecure-requests");
  });

  it("grants geolocation and denies camera/mic/payment", () => {
    expect(PERMISSIONS_POLICY).toContain("geolocation=(self)");
    expect(PERMISSIONS_POLICY).toContain("camera=()");
    expect(PERMISSIONS_POLICY).toContain("microphone=()");
    expect(PERMISSIONS_POLICY).toContain("payment=()");
  });

  it("exposes both headers through securityHeaders()", () => {
    const keys = securityHeaders(false).map((h) => h.key);
    expect(keys).toContain("Content-Security-Policy");
    expect(keys).toContain("Permissions-Policy");
  });
});
