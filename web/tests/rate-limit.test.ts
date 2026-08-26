import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as searchGET } from "@/app/api/places/search/route";
import {
  checkRateLimit,
  IMAGE_RATE_LIMIT,
  PLACES_RATE_LIMIT,
  PROFILE_READ_RATE_LIMIT,
  RateLimiter,
  SEARCH_RATE_LIMITS,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

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

describe("getClientIdentifier", () => {
  it("uses the user id when signed in", () => {
    const request = new Request("https://example.com/api/test");
    expect(getClientIdentifier(request, { id: "user-123" })).toBe("user:user-123");
  });

  it("hashes User-Agent and IP headers for anonymous requests", () => {
    const request = new Request("https://example.com/api/test", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      },
    });
    const id = getClientIdentifier(request, null);
    expect(id.startsWith("anon:")).toBe(true);
    expect(id).not.toContain("Mozilla");
    expect(id).not.toContain("1.2.3.4");
  });

  it("prefers CF-Connecting-IP over a spoofable X-Forwarded-For (review 2026-08-09)", () => {
    const withCf = new Request("https://example.com/api/test", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "cf-connecting-ip": "9.9.9.9",
        "x-forwarded-for": "1.2.3.4",
      },
    });
    const withoutCf = new Request("https://example.com/api/test", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "x-forwarded-for": "9.9.9.9",
      },
    });
    // Same real IP must hash identically whether CF-IP or XFF carries it...
    expect(getClientIdentifier(withCf, null)).toBe(getClientIdentifier(withoutCf, null));

    // ...and a spoofed XFF cannot change the identifier when CF-IP is present.
    const spoofed = new Request("https://example.com/api/test", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "cf-connecting-ip": "9.9.9.9",
        "x-forwarded-for": "6.6.6.6",
      },
    });
    expect(getClientIdentifier(spoofed, null)).toBe(getClientIdentifier(withCf, null));
  });

  it("uses the rightmost X-Forwarded-For entry (closest to the server) when no CF-IP", () => {
    const left = new Request("https://example.com/api/test", {
      headers: { "user-agent": "Mozilla/5.0", "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    const spoofedLeft = new Request("https://example.com/api/test", {
      headers: { "user-agent": "Mozilla/5.0", "x-forwarded-for": "9.9.9.9, 1.1.1.1, 2.2.2.2" },
    });
    expect(getClientIdentifier(left, null)).toBe(getClientIdentifier(spoofedLeft, null));
  });

  it("falls back to a local-dev identifier when no headers are present", () => {
    const request = new Request("https://example.com/api/test");
    expect(getClientIdentifier(request, null)).toBe("anon:local-dev");
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
    for (let i = 0; i < PLACES_RATE_LIMIT.maxRequests; i++) {
      await rateLimiter.check(
        `places:${getClientIdentifier(new Request("https://localhost/api/places/search?q=x"), null)}`,
        PLACES_RATE_LIMIT.windowMs,
        PLACES_RATE_LIMIT.maxRequests,
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

it("exports sensible image and places rate-limit defaults", () => {
  expect(IMAGE_RATE_LIMIT).toEqual({ windowMs: 60_000, maxRequests: 10 });
  expect(PLACES_RATE_LIMIT).toEqual({ windowMs: 60_000, maxRequests: 30 });
});

describe("checkRateLimit multi-window", () => {
  it("enforces all windows (each consumes a token, any deny blocks)", async () => {
    const buckets = [
      { windowMs: 60_000, maxRequests: 2 },
      { windowMs: 120_000, maxRequests: 5 },
    ];
    const base = `search:${getClientIdentifier(new Request("https://localhost/api/search?q=x"), null)}:multi-${Date.now()}-${Math.random()}`;

    // 2 allowed (small window at limit, large still has room)
    expect((await checkRateLimit(base, buckets, "search")).allowed).toBe(true);
    expect((await checkRateLimit(base, buckets, "search")).allowed).toBe(true);

    // 3rd trips the 60s window (2/2) even though 120s still has room → 429
    const denied = await checkRateLimit(base, buckets, "search");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThan(0);
  });

  it("emits an alert via the observability hook on deny (DG129)", async () => {
    const buckets = [{ windowMs: 60_000, maxRequests: 1 }];
    const base = `profile-read:user:test-alert-${Date.now()}`;
    await checkRateLimit(base, buckets, "profile-read", "GET /api/profile"); // consume
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Reset throttle so the alert fires
    const { _resetAlertThrottleForTests } = await import("@/lib/observability/rate-limit-alert");
    _resetAlertThrottleForTests();

    const denied = await checkRateLimit(base, buckets, "profile-read", "GET /api/profile");
    expect(denied.allowed).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

it("exports search + profile rate-limit defaults (DG129, #216)", () => {
  expect(SEARCH_RATE_LIMITS).toEqual([
    { windowMs: 60_000, maxRequests: 30 },
    { windowMs: 3_600_000, maxRequests: 100 },
    { windowMs: 86_400_000, maxRequests: 200 },
  ]);
  expect(PROFILE_READ_RATE_LIMIT).toEqual({ windowMs: 60_000, maxRequests: 30 });
});
