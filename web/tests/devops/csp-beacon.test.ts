import { describe, expect, it } from "vitest";
import { cloudflareBeaconAllowed, contentSecurityPolicy } from "@/lib/security/headers";

/**
 * BRAWUKA-981: Cloudflare's zone-level Web Analytics `auto_install` injects
 * `beacon.min.js` into every hostname of `cafemood.app`, staging included.
 * A CSP exception keyed on the production deploy alone therefore left every
 * staging page load logging a `script-src` violation. The exception follows
 * the deploy environment because that is what the edge actually does.
 */
const BEACON_SCRIPT = "https://static.cloudflareinsights.com";
const BEACON_CONNECT = "https://cloudflareinsights.com";

/** Serialized value of one directive (`policy` is joined with "; "). */
function directive(policy: string, name: string): string {
  return policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
}

describe("cloudflareBeaconAllowed", () => {
  it("grants the beacon on both deployed environments", () => {
    expect(cloudflareBeaconAllowed("production")).toBe(true);
    expect(cloudflareBeaconAllowed("staging")).toBe(true);
  });

  it("stays closed where no zone edge injects the beacon", () => {
    expect(cloudflareBeaconAllowed(undefined)).toBe(false);
    expect(cloudflareBeaconAllowed("")).toBe(false);
    expect(cloudflareBeaconAllowed("local")).toBe(false);
  });
});

describe("contentSecurityPolicy beacon exception", () => {
  it("allows the beacon hosts for a staging build", () => {
    const policy = contentSecurityPolicy(true, cloudflareBeaconAllowed("staging"));

    expect(directive(policy, "script-src")).toContain(BEACON_SCRIPT);
    expect(directive(policy, "connect-src")).toContain(BEACON_CONNECT);
  });

  it("leaves the policy closed without a deploy environment", () => {
    const policy = contentSecurityPolicy(true, cloudflareBeaconAllowed(undefined));

    expect(policy).not.toContain(BEACON_SCRIPT);
    expect(policy).not.toContain(BEACON_CONNECT);
  });

  it("never widens script-src past 'unsafe-inline'", () => {
    const policy = contentSecurityPolicy(true, cloudflareBeaconAllowed("production"));
    const scriptSrc = directive(policy, "script-src");

    expect(policy).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain(BEACON_CONNECT);
  });
});
