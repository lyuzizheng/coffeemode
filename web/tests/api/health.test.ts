import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getHealth, HEAD as headHealth } from "@/app/api/health/route";
import { resolveAppVersion } from "@/lib/version";

describe("health API contracts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.APP_VERSION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET /api/health returns ok:true, version, and boot_time", async () => {
    const res = getHealth();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.boot_time).toBe("string");
    expect(new Date(body.boot_time).getTime()).not.toBeNaN();
  });

  it("HEAD /api/health returns 200 without body", async () => {
    const res = headHealth();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("resolveAppVersion respects APP_VERSION environment variable", () => {
    process.env.APP_VERSION = "v1.2.3-test";
    expect(resolveAppVersion()).toBe("v1.2.3-test");
  });

  it("resolveAppVersion returns development fallback when APP_VERSION unset", () => {
    expect(resolveAppVersion()).toBe("development");
  });
});
