import { describe, expect, it } from "vitest";
import {
  PERMISSIONS_POLICY,
  contentSecurityPolicy,
  securityHeaders,
} from "@/lib/security/headers";

/**
 * BRAWUKA-633: the baseline CSP + Permissions-Policy contract is executable
 * config, not a comment. These tests pin one assertion per real client load
 * so a host-inventory gap breaks the suite instead of a shipped feature:
 * no `unsafe-eval`, no bare-wildcard sources, geolocation granted
 * (onboarding locate), camera/mic/payment denied.
 */
describe("baseline security headers", () => {
  it("grants default-src 'self' with the required external exceptions", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("default-src 'self'");
    // MapKit SDK script must load (apple-place-search.ts MAPKIT_SCRIPT).
    expect(csp).toContain("https://cdn.apple-mapkit.com");
    // Turnstile widget/frame must load (turnstile-client.ts TURNSTILE_SCRIPT).
    expect(csp).toContain("https://challenges.cloudflare.com");
    // MapLibre tiles + glyph PBFs must connect (public/map/*.json).
    expect(csp).toContain("https://tiles.openfreemap.org");
    // MapKit JS bootstrap-driven search base + server-side REST host.
    expect(csp).toContain("https://api.apple-mapkit.com");
    expect(csp).toContain("https://maps-api.apple.com");
  });

  it("allows presigned photo PUTs to the R2 API host (client-upload.ts)", () => {
    // Prod/staging sign against https://<account>.r2.cloudflarestorage.com
    // (image-service R2_ENDPOINT=""); without this every check-in photo PUT fails.
    expect(contentSecurityPolicy(true)).toContain("https://*.r2.cloudflarestorage.com");
  });

  it("allows blob: draft photo previews (checkin-photos, checkin-resume)", () => {
    // URL.createObjectURL previews render as <img src="blob:…">.
    const imgSrc = contentSecurityPolicy(false).match(/img-src ([^;]+)/)?.[1] ?? "";
    expect(imgSrc).toMatch(/(^|\s)blob:(;|\s|$)/);
  });

  it("allows local MinIO only outside production", () => {
    expect(contentSecurityPolicy(false)).toContain("http://localhost:9000");
    expect(contentSecurityPolicy(true)).not.toContain("http://localhost:9000");
  });

  it("never grants unsafe-eval or bare-wildcard sources", () => {
    // `*.r2.cloudflarestorage.com` is a scoped subdomain wildcard, not a
    // bare `*` — the regex below must not trip on it.
    for (const csp of [contentSecurityPolicy(false), contentSecurityPolicy(true)]) {
      expect(csp).not.toContain("unsafe-eval");
      expect(csp).not.toMatch(/(^|\s)\*(;|\s|$)/);
      expect(csp).toContain("https://*.r2.cloudflarestorage.com");
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
