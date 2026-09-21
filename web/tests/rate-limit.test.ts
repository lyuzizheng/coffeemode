import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as searchGET } from "@/app/api/places/search/route";
import {
  checkRateLimit,
  RateLimiter,
  getClientIdentity,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { rateLimitBuckets, rateLimitConfig } from "@/lib/config";
import { registerLineSink } from "@shared/log";

const WORKER_URL = "https://poi-service.test.workers.dev";
const TOKEN = "s3cret-token";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("RateLimiter", () => {
  let limiter: RateLimiter;
  let nowSpy: ReturnType<typeof vi.spyOn>;
  let now = 0;

  beforeEach(() => {
    limiter = new RateLimiter();
    now = 0;
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it("allows requests up to the limit", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await limiter.check("key", 60_000, 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it("blocks requests after the limit is exhausted", async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.check("key", 60_000, 5);
    }
    const result = await limiter.check("key", 60_000, 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBe(60);
  });

  it("refills the bucket after the window passes", async () => {
    await limiter.check("key", 60_000, 1);
    expect((await limiter.check("key", 60_000, 1)).allowed).toBe(false);

    now = 60_001;
    const result = await limiter.check("key", 60_000, 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("resets the bucket when the maxRequests or window changes", async () => {
    await limiter.check("key", 60_000, 2);
    await limiter.check("key", 60_000, 2);
    expect((await limiter.check("key", 60_000, 2)).allowed).toBe(false);

    // Different window should create a new bucket.
    const result = await limiter.check("key", 30_000, 2);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it("cleans up stale buckets", async () => {
    await limiter.check("a", 60_000, 1);
    now = 120_001;
    await limiter.check("b", 60_000, 1);

    // Bucket 'a' should be pruned; a new check creates a fresh one.
    const result = await limiter.check("a", 60_000, 1);
    expect(result.allowed).toBe(true);
  });

  it("produces a 429 response with Retry-After", async () => {
    await limiter.check("key", 60_000, 1);
    await limiter.check("key", 60_000, 1); // exhaust
    const blocked = await limiter.check("key", 60_000, 1);

    const response = rateLimitResponse(blocked);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe(String(blocked.retryAfter));
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});

describe("getClientIdentity", () => {
  it("uses the user id when signed in", () => {
    const request = new Request("https://example.com/api/test");
    expect(getClientIdentity(request, { id: "user-123" })).toEqual({ id: "user:user-123", ip: null });
  });

  it("hashes CF-Connecting-IP and never leaks it for anonymous requests", () => {
    const request = new Request("https://example.com/api/test", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "cf-connecting-ip": "1.2.3.4",
      },
    });
    const { id, ip } = getClientIdentity(request, null);
    expect(id.startsWith("anon:")).toBe(true);
    expect(id).not.toContain("Mozilla");
    expect(id).not.toContain("1.2.3.4");
    // The raw address rides alongside the key so an abuse alert can name the source.
    expect(ip).toBe("1.2.3.4");
  });

  it("ignores forged X-Real-IP / X-Forwarded-For and rotated User-Agents: same bucket (BRAWUKA-282 P1-2 gate)", () => {
    const first = new Request("https://example.com/api/test", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "cf-connecting-ip": "9.9.9.9",
        "x-real-ip": "1.1.1.1",
        "x-forwarded-for": "1.1.1.1",
      },
    });
    const rotated = new Request("https://example.com/api/test", {
      headers: {
        "user-agent": "curl/8.0",
        "cf-connecting-ip": "9.9.9.9",
        "x-real-ip": "2.2.2.2",
        "x-forwarded-for": "2.2.2.2, 3.3.3.3",
      },
    });
    expect(getClientIdentity(first, null).id).toBe(getClientIdentity(rotated, null).id);
  });

  it("keys distinct CF-Connecting-IPs into distinct buckets", () => {
    const base = new Request("https://example.com/api/test", {
      headers: { "user-agent": "Mozilla/5.0", "cf-connecting-ip": "9.9.9.9" },
    });
    const otherIp = new Request("https://example.com/api/test", {
      headers: { "user-agent": "Mozilla/5.0", "cf-connecting-ip": "8.8.8.8" },
    });
    expect(getClientIdentity(otherIp, null).id).not.toBe(getClientIdentity(base, null).id);
  });

  it("shares one fail-closed bucket when CF-Connecting-IP is absent", () => {
    const request = new Request("https://example.com/api/test");
    expect(getClientIdentity(request, null)).toEqual({ id: "anon:unknown", ip: null });
    const forged = new Request("https://example.com/api/test", {
      headers: { "user-agent": "curl/8.0", "x-real-ip": "1.1.1.1" },
    });
    expect(getClientIdentity(forged, null)).toEqual({ id: "anon:unknown", ip: null });
  });
});

describe("Route rate limiting", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env.POI_SERVICE_URL = WORKER_URL;
    process.env.POI_SERVICE_TOKEN = TOKEN;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await rateLimiter.reset();
  });

  afterEach(async () => {
    delete process.env.POI_SERVICE_URL;
    delete process.env.POI_SERVICE_TOKEN;
    vi.unstubAllGlobals();
    await rateLimiter.reset();
  });

  it("returns 429 when the places rate limit is exhausted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    // Exhaust the anonymous places bucket.
    const placesLimit = rateLimitConfig("places");
    for (let i = 0; i < placesLimit.maxRequests; i++) {
      await rateLimiter.check(
        `places:${getClientIdentity(new Request("https://localhost/api/places/search?q=x"), null).id}`,
        placesLimit.windowMs,
        placesLimit.maxRequests,
      );
    }

    const res = await searchGET(new Request(`${WORKER_URL}/api/places/search?q=x`));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("reads image and places rate-limit defaults from rate-limits.yaml (DG74/DG107)", () => {
  expect(rateLimitConfig("images")).toEqual({ windowMs: 60_000, maxRequests: 10 });
  expect(rateLimitConfig("places")).toEqual({ windowMs: 60_000, maxRequests: 30 });
});

describe("checkRateLimit multi-window", () => {
  it("enforces all windows (each consumes a token, any deny blocks)", async () => {
    const buckets = [
      { windowMs: 60_000, maxRequests: 2 },
      { windowMs: 120_000, maxRequests: 5 },
    ];
    const clientId = `test-client-multi-${Date.now()}`;

    // 2 allowed (small window at limit, large still has room)
    expect((await checkRateLimit("search", { id: clientId, ip: null }, buckets)).allowed).toBe(true);
    expect((await checkRateLimit("search", { id: clientId, ip: null }, buckets)).allowed).toBe(true);

    // 3rd trips the 60s window (2/2) even though 120s still has room → 429
    const denied = await checkRateLimit("search", { id: clientId, ip: null }, buckets);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("emits an alert via the observability hook on deny (DG129)", async () => {
    const buckets = [{ windowMs: 60_000, maxRequests: 1 }];
    const clientId = `user:test-alert-${Date.now()}`;
    await checkRateLimit("profile-read", { id: clientId, ip: null }, buckets, "GET /api/profile"); // consume
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset throttle so the alert fires
    const { _resetAlertThrottleForTests } = await import("@/lib/observability/rate-limit-alert");
    _resetAlertThrottleForTests();

    const denied = await checkRateLimit("profile-read", { id: clientId, ip: null }, buckets, "GET /api/profile");
    expect(denied.allowed).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("emits one unthrottled structured line per denial, carrying the raw client_ip (BRAWUKA-607)", async () => {
    const buckets = [{ windowMs: 60_000, maxRequests: 1 }];
    const client = { id: `anon:test-ip-${Date.now()}`, ip: "203.0.113.7" };
    const lines: Record<string, unknown>[] = [];
    registerLineSink((line) => lines.push(line));
    const { _resetAlertThrottleForTests } = await import("@/lib/observability/rate-limit-alert");
    _resetAlertThrottleForTests();

    await checkRateLimit("places", client, buckets, "GET /api/places/search"); // consume
    // Two denials inside the 10s console throttle: the console line is
    // suppressed, the structured line must not be — the count is the signal.
    await checkRateLimit("places", client, buckets, "GET /api/places/search");
    await checkRateLimit("places", client, buckets, "GET /api/places/search");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      type: "warn",
      route: "GET /api/places/search",
      status: 429,
      code: "rate_limited",
      client_id: client.id,
      client_ip: "203.0.113.7",
      bucket: "places",
    });
    expect(lines[0].retry_after).toBeGreaterThan(0);

    registerLineSink(null);
  });
});

  it("throws an unreachable error on an empty buckets array (caller bug, BRAWUKA-189)", async () => {
    await expect(checkRateLimit("search", { id: "test-client-empty", ip: null }, [])).rejects.toThrow("unreachable");
  });

it("reads search + profile rate-limit defaults from rate-limits.yaml (DG129, #216)", () => {
  expect(rateLimitBuckets("search")).toEqual([
    { windowMs: 60_000, maxRequests: 30 },
    { windowMs: 3_600_000, maxRequests: 100 },
    { windowMs: 86_400_000, maxRequests: 200 },
  ]);
  expect(rateLimitConfig("profile-read")).toEqual({ windowMs: 60_000, maxRequests: 30 });
});
