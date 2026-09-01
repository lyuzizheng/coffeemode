import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";
import { executeSearch } from "@/lib/search/search-service";
import { checkRateLimit } from "@/lib/rate-limit";
import type { SearchResponse } from "@/lib/search/types";

vi.mock("@/lib/search/search-service", () => ({
  executeSearch: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 }),
  };
});

describe("GET /api/search route", () => {
  const mockResponse: SearchResponse = {
    results: [],
    total_count: 0,
    is_weak_results: true,
    reference_point: { lat: 1.35, lng: 103.8, is_from_city_center: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 });
    vi.mocked(executeSearch).mockResolvedValue(mockResponse);
  });

  it("rejects out-of-range latitude with 400", async () => {
    const req = new Request("http://localhost/api/search?lat=95&lng=103.8");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects out-of-range longitude with 400", async () => {
    const req = new Request("http://localhost/api/search?lat=1.35&lng=190");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects negative or non-integer limit with 400", async () => {
    const req1 = new Request("http://localhost/api/search?limit=-5");
    const res1 = await GET(req1);
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toBe("invalid_request");
    expect(body1.message).toBe("limit must be a positive integer");

    const req2 = new Request("http://localhost/api/search?limit=0");
    const res2 = await GET(req2);
    expect(res2.status).toBe(400);

    const req3 = new Request("http://localhost/api/search?limit=3.5");
    const res3 = await GET(req3);
    expect(res3.status).toBe(400);
  });

  it("rejects non-numeric limit with 400", async () => {
    const req = new Request("http://localhost/api/search?limit=abc");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });

  it("rejects unknown explicit city with 400 (DG128)", async () => {
    const req = new Request("http://localhost/api/search?city=paris");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
    expect(body.message).toBe("unknown city");
    expect(executeSearch).not.toHaveBeenCalled();
  });

  it("resolves omitted city via cf-ipcity header (DG128)", async () => {
    const req = new Request("http://localhost/api/search?q=coffee", {
      headers: { "cf-ipcity": "Tokyo", "cf-ipcountry": "JP" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(executeSearch).toHaveBeenCalledWith(expect.objectContaining({ city: "tokyo" }));
  });

  it("resolves omitted city via cf-ipcountry fallback when cf-ipcity misses", async () => {
    const req = new Request("http://localhost/api/search?q=coffee", {
      headers: { "cf-ipcity": "Nowhere", "cf-ipcountry": "SG" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(executeSearch).toHaveBeenCalledWith(expect.objectContaining({ city: "singapore" }));
  });

  it("falls back to default city when no headers present", async () => {
    const req = new Request("http://localhost/api/search?q=coffee");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(executeSearch).toHaveBeenCalledWith(expect.objectContaining({ city: "singapore" }));
  });

  it("parses query params and calls executeSearch", async () => {

    const req = new Request(
      "http://localhost/api/search?q=coffee&city=tokyo&filter_wifi=80&open_now=true&filter_max_stay=unlimited&include_live=true",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(executeSearch).toHaveBeenCalledWith({
      q: "coffee",
      city: "tokyo",
      lat: undefined,
      lng: undefined,
      open_now: true,
      include_live: true,
      filter_wifi: 80,
      filter_max_stay: "unlimited",
      limit: undefined,
    });
  });

  it("handles rate limiting with 429", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      retryAfter: 30,
      remaining: 0,
      resetAt: Date.now() + 30000,
    });

    const req = new Request("http://localhost/api/search?q=coffee");
    const res = await GET(req);

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("calls checkRateLimit with the multi-window search buckets", async () => {
    vi.mocked(executeSearch).mockResolvedValue({
      results: [],
      total_count: 0,
      is_weak_results: true,
      reference_point: { lat: 1.35, lng: 103.8, is_from_city_center: true },
    });
    const req = new Request("http://localhost/api/search?q=coffee");
    await GET(req);
    expect(checkRateLimit).toHaveBeenCalledWith(
      "search",
      expect.stringMatching(/^anon:/),
      expect.arrayContaining([
        expect.objectContaining({ windowMs: 60_000, maxRequests: 30 }),
        expect.objectContaining({ windowMs: 3_600_000, maxRequests: 100 }),
        expect.objectContaining({ windowMs: 86_400_000, maxRequests: 200 }),
      ]),
      "GET /api/search",
    );
  });

  it("returns 500 internal_error when executeSearch throws", async () => {
    vi.mocked(executeSearch).mockRejectedValueOnce(new Error("DB connection crash"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost/api/search?q=crash");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("DG137-B: sets Cache-Control header on success path only", async () => {
    const req = new Request("http://localhost/api/search?q=coffee");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "private, max-age=10, stale-while-revalidate=30",
    );
  });

  it("DG132: sets X-Search-Mode header based on executeSearch mode", async () => {
    vi.mocked(executeSearch).mockResolvedValueOnce({
      ...mockResponse,
      search_mode: "live",
    });

    const req = new Request("http://localhost/api/search?q=coffee&include_live=true");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Search-Mode")).toBe("live");
  });

  it("DG140: prod mode ignores ?fixtures=1 param and executes search", async () => {
    vi.stubEnv("SEARCH_FIXTURES", "1");
    vi.stubEnv("NODE_ENV", "production");

    try {
      const req = new Request("http://localhost/api/search?fixtures=1&q=coffee");
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(executeSearch).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("DG140: dev mode with SEARCH_FIXTURES=1 returns fixture response without executeSearch", async () => {
    vi.stubEnv("SEARCH_FIXTURES", "1");
    vi.stubEnv("NODE_ENV", "development");

    try {
      vi.mocked(executeSearch).mockClear();
      const req = new Request("http://localhost/api/search?fixtures=1");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results.length).toBeGreaterThan(0);
      expect(executeSearch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
