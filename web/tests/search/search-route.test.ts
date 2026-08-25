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

  it("parses query params and calls executeSearch", async () => {
    const mockResponse: SearchResponse = {
      results: [],
      total_count: 0,
      is_weak_results: true,
      reference_point: { lat: 1.35, lng: 103.8, is_from_city_center: true },
    };
    vi.mocked(executeSearch).mockResolvedValue(mockResponse);

    const req = new Request(
      "http://localhost/api/search?q=coffee&city=tokyo&filter_wifi=80&open_now=true&filter_min_spend=drink",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(executeSearch).toHaveBeenCalledWith({
      q: "coffee",
      city: "tokyo",
      lat: undefined,
      lng: undefined,
      open_now: true,
      filter_wifi: 80,
      filter_outlets: undefined,
      filter_seats: undefined,
      filter_temp: undefined,
      filter_coffee: undefined,
      filter_overall: undefined,
      filter_min_spend: "drink",
      filter_max_stay: undefined,
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
});
