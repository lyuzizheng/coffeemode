import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getHealth, HEAD as headHealth } from "@/app/api/health/route";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveAppVersion } from "@/lib/version";

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 }),
  };
});
describe("health API contracts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.APP_VERSION;
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET /api/health returns ok:true, version, and boot_time", async () => {
    const res = await getHealth(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
    expect(typeof body.boot_time).toBe("string");
    expect(new Date(body.boot_time).getTime()).not.toBeNaN();
    // Edge-less infra probes (Traefik/Docker, no cf-connecting-ip) bypass the
    // bucket: LB health must never depend on a bucket flooders can fill.
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("HEAD /api/health returns 200 without body", async () => {
    const res = await headHealth(new Request("http://localhost/api/health", { method: "HEAD" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("GET /api/health consumes the bucket on the Cloudflare path (BRAWUKA-639)", async () => {
    const res = await getHealth(
      new Request("http://localhost/api/health", { headers: { "cf-connecting-ip": "203.0.113.7" } }),
    );
    expect(res.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkRateLimit).mock.calls[0][0]).toBe("health");
    expect(vi.mocked(checkRateLimit).mock.calls[0][1]).toMatchObject({ id: expect.stringMatching(/^anon:/) });
  });

  it("GET /api/health returns 429 when the health bucket trips (BRAWUKA-639)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
    });
    const res = await getHealth(
      new Request("http://localhost/api/health", { headers: { "cf-connecting-ip": "203.0.113.7" } }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
  });

  it("HEAD /api/health returns 429 when the health bucket trips (BRAWUKA-639)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
    });
    const res = await headHealth(
      new Request("http://localhost/api/health", { method: "HEAD", headers: { "cf-connecting-ip": "203.0.113.7" } }),
    );
    expect(res.status).toBe(429);
  });

  it("edge-less flood can never 429 the LB probes (BRAWUKA-639 P1)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
    });
    for (const method of ["GET", "HEAD"] as const) {
      const handler = method === "GET" ? getHealth : headHealth;
      const res = await handler(new Request("http://localhost/api/health", { method }));
      expect(res.status).toBe(200);
    }
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("resolveAppVersion respects APP_VERSION environment variable", () => {
    process.env.APP_VERSION = "v1.2.3-test";
    expect(resolveAppVersion()).toBe("v1.2.3-test");
  });

  it("resolveAppVersion returns valid fallback when APP_VERSION unset", () => {
    const version = resolveAppVersion();
    expect(typeof version).toBe("string");
    expect(version.length).toBeGreaterThan(0);
  });
});
