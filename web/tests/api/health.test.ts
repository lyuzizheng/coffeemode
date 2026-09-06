import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getHealth, HEAD as headHealth } from "@/app/api/health/route";
import { GET as getVersion } from "@/app/api/health/version/route";
import { resolveAppVersion } from "@/lib/version";

describe("health and version API contracts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.APP_VERSION;
    delete process.env.RELEASE_TAG;
    delete process.env.NEXT_PUBLIC_APP_VERSION;
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

  it("GET /api/health/version returns version and boot_time", async () => {
    const res = getVersion();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.boot_time).toBe("string");
  });

  it("resolveAppVersion respects APP_VERSION environment variable", () => {
    process.env.APP_VERSION = "v1.2.3-test";
    expect(resolveAppVersion()).toBe("v1.2.3-test");
  });

  it("resolveAppVersion respects RELEASE_TAG when APP_VERSION unset", () => {
    process.env.RELEASE_TAG = "commit-abc1234";
    expect(resolveAppVersion()).toBe("commit-abc1234");
  });

  it("resolveAppVersion respects NEXT_PUBLIC_APP_VERSION fallback", () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "2026.09.06";
    expect(resolveAppVersion()).toBe("2026.09.06");
  });
});
