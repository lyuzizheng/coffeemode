import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as searchGET } from "@/app/api/places/search/route";
import {
  IMAGE_RATE_LIMIT,
  PLACES_RATE_LIMIT,
  RateLimiter,
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

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      const result = limiter.check("key", 60_000, 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it("blocks requests after the limit is exhausted", () => {
    for (let i = 0; i < 5; i++) {
      limiter.check("key", 60_000, 5);
    }
    const result = limiter.check("key", 60_000, 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBe(60);
  });

  it("refills the bucket after the window passes", () => {
    limiter.check("key", 60_000, 1);
    expect(limiter.check("key", 60_000, 1).allowed).toBe(false);

    now = 60_001;
    const result = limiter.check("key", 60_000, 1);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("resets the bucket when the maxRequests or window changes", () => {
    limiter.check("key", 60_000, 2);
    limiter.check("key", 60_000, 2);
    expect(limiter.check("key", 60_000, 2).allowed).toBe(false);

    // Different window should create a new bucket.
    const result = limiter.check("key", 30_000, 2);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it("cleans up stale buckets", () => {
    limiter.check("a", 60_000, 1);
    now = 120_001;
    limiter.check("b", 60_000, 1);

    // Bucket 'a' should be pruned; a new check creates a fresh one.
    const result = limiter.check("a", 60_000, 1);
    expect(result.allowed).toBe(true);
  });

  it("produces a 429 response with Retry-After", () => {
    limiter.check("key", 60_000, 1);
    limiter.check("key", 60_000, 1); // exhaust
    const blocked = limiter.check("key", 60_000, 1);

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

  it("falls back to a local-dev identifier when no headers are present", () => {
    const request = new Request("https://example.com/api/test");
    expect(getClientIdentifier(request, null)).toBe("anon:local-dev");
  });
});

describe("Route rate limiting", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.POI_SERVICE_URL = WORKER_URL;
    process.env.POI_SERVICE_TOKEN = TOKEN;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    rateLimiter.reset();
  });

  afterEach(() => {
    delete process.env.POI_SERVICE_URL;
    delete process.env.POI_SERVICE_TOKEN;
    vi.unstubAllGlobals();
    rateLimiter.reset();
  });

  it("returns 429 when the places rate limit is exhausted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }));

    // Exhaust the anonymous places bucket.
    for (let i = 0; i < PLACES_RATE_LIMIT.maxRequests; i++) {
      rateLimiter.check(
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
