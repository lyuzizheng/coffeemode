import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";
import { executeSearch } from "@/lib/search/search-service";
import { rateLimiter } from "@/lib/rate-limit";
import type { SearchResponse } from "@/lib/search/types";

vi.mock("@/lib/search/search-service", () => ({
  executeSearch: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
}));

describe("GET /api/search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("parses query params and calls executeSearch", async () => {
    const mockResponse: SearchResponse = {
      results: [],
      total_count: 0,
      is_weak_results: true,
      reference_point: { lat: 1.35, lng: 103.8, is_from_city_center: true },
    };
    vi.mocked(executeSearch).mockResolvedValue(mockResponse);

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
    vi.spyOn(rateLimiter, "check").mockResolvedValueOnce({
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

  it("returns 500 internal_error when executeSearch throws", async () => {
    vi.mocked(executeSearch).mockRejectedValueOnce(new Error("DB connection crash"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost/api/search?q=crash");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
