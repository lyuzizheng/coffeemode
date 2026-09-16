import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  guard,
  readJsonBody,
  RATE_LIMIT_BUCKET_NAMES,
  type RateLimitBucketName,
} from "@/lib/api/guard";
import { getCurrentUser } from "@/lib/auth/get-user";
import { checkRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(),
  };
});

describe("guard helper (BRAWUKA-181)", () => {
  const mockUser = { id: "00000000-0000-4000-a000-000000000001" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 60000,
      retryAfter: 0,
    });
  });

  describe("authentication & anonymous handling", () => {
    it("returns 401 unauthorized when anonymous and requireAuth is true", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
      const req = new Request("http://localhost/api/cafes", { method: "POST" });

      const result = await guard(req, {
        bucket: "cafes-write",
        requireAuth: true,
        route: "POST /api/cafes",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
        const body = await result.response.json();
        expect(body).toEqual({ error: "unauthorized" });
      }
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it("allows anonymous request when requireAuth is false/omitted", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
      const req = new Request("http://localhost/api/cafes", { method: "GET" });

      const result = await guard(req, {
        bucket: "cafes-read",
        route: "GET /api/cafes",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user).toBeNull();
        expect(result.clientId).toMatch(/^anon:/);
        expect(result.route).toBe("GET /api/cafes");
      }
      expect(checkRateLimit).toHaveBeenCalledWith(
        "cafes-read",
        expect.stringMatching(/^anon:/),
        expect.any(Array),
        "GET /api/cafes",
      );
    });

    it("allows authenticated user when requireAuth is true", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
      const req = new Request("http://localhost/api/cafes", { method: "POST" });

      const result = await guard(req, {
        bucket: "cafes-write",
        requireAuth: true,
        route: "POST /api/cafes",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user).toEqual(mockUser);
        expect(result.clientId).toBe(`user:${mockUser.id}`);
      }
      expect(checkRateLimit).toHaveBeenCalledWith(
        "cafes-write",
        `user:${mockUser.id}`,
        expect.any(Array),
        "POST /api/cafes",
      );
    });

    it("uses pre-resolved user when provided", async () => {
      const req = new Request("http://localhost/api/cafes", { method: "POST" });

      const result = await guard(req, {
        bucket: "cafes-write",
        requireAuth: true,
        user: mockUser,
        route: "POST /api/cafes",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user).toEqual(mockUser);
        expect(result.clientId).toBe(`user:${mockUser.id}`);
      }
      expect(getCurrentUser).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting & 429 response", () => {
    it("returns 429 rate_limited with Retry-After when rate limit trips", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
      vi.mocked(checkRateLimit).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 45000,
        retryAfter: 45,
      });

      const req = new Request("http://localhost/api/cafes", { method: "POST" });

      const result = await guard(req, {
        bucket: "cafes-write",
        requireAuth: true,
        route: "POST /api/cafes",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(429);
        expect(result.response.headers.get("Retry-After")).toBe("45");
        const body = await result.response.json();
        // Machine code only (BRAWUKA-280): the client renders its own
        // localized fallback, never hardcoded English from the envelope.
        expect(body).toEqual({ error: "rate_limited" });
      }
    });

    it("scopes clientId to IP when ipOnly is true even if authenticated", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
      const req = new Request("http://localhost/api/search", { method: "GET" });

      const result = await guard(req, {
        bucket: "search",
        route: "GET /api/search",
        ipOnly: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user).toEqual(mockUser);
        expect(result.clientId).toMatch(/^anon:/);
      }
      expect(checkRateLimit).toHaveBeenCalledWith(
        "search",
        expect.stringMatching(/^anon:/),
        expect.any(Array),
        "GET /api/search",
      );
    });
  });

  describe("bucket validation (compile-time & runtime double check)", () => {
    it("throws Error on invalid/undeclared bucket name", async () => {
      const req = new Request("http://localhost/api/cafes", { method: "GET" });

      await expect(
        guard(req, {
          bucket: "invalid-bucket-name" as RateLimitBucketName,
        }),
      ).rejects.toThrow(/Invalid rate limit bucket/);
    });

    it("accepts all declared bucket names from rate-limits.yaml", async () => {
      for (const bucket of RATE_LIMIT_BUCKET_NAMES) {
        const req = new Request("http://localhost/api/test", { method: "GET" });
        const res = await guard(req, { bucket });
        expect(res.ok).toBe(true);
      }
    });
  });

  describe("route string resolution", () => {
    it("uses fallback method and pathname when route is omitted", async () => {
      const req = new Request("http://localhost/api/cafes?limit=10", { method: "GET" });

      const result = await guard(req, { bucket: "cafes-read" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.route).toBe("GET /api/cafes");
      }
      expect(checkRateLimit).toHaveBeenCalledWith(
        "cafes-read",
        expect.any(String),
        expect.any(Array),
        "GET /api/cafes",
      );
    });
  });
});

describe("readJsonBody helper (BRAWUKA-181)", () => {
  it("parses valid JSON object successfully", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ name: "Single Origin Coffee", wifi: 90 }),
    });

    const result = await readJsonBody<{ name: string; wifi: number }>(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: "Single Origin Coffee", wifi: 90 });
    }
  });

  it("returns 400 invalid_request on malformed non-JSON body", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: "not-valid-json{",
    });

    const result = await readJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body).toEqual({
        error: "invalid_request",
        message: "invalid JSON body",
      });
    }
  });

  it("returns 400 invalid_request on empty body when not optional", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: "",
    });

    const result = await readJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body).toEqual({
        error: "invalid_request",
        message: "invalid JSON body",
      });
    }
  });

  it("returns ok: true with data: null on empty body when optional is true", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "DELETE",
      body: "",
    });

    const result = await readJsonBody(req, { optional: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it("returns 413 when Content-Length declares over 64KiB (BRAWUKA-315)", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: JSON.stringify({ note: "small" }),
      headers: { "content-length": String(64 * 1024 + 1) },
    });

    const result = await readJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      const body = await result.response.json();
      expect(body).toEqual({
        error: "invalid_request",
        message: "request body too large",
      });
    }
  });

  it("returns 413 while streaming a chunked body over 64KiB (BRAWUKA-315)", async () => {
    const encoder = new TextEncoder();
    const chunk = encoder.encode("x".repeat(32 * 1024));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(encoder.encode("x"));
        controller.close();
      },
    });
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      body: stream as BodyInit,
      duplex: "half",
    } as RequestInit);

    const result = await readJsonBody(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      const body = await result.response.json();
      expect(body).toEqual({
        error: "invalid_request",
        message: "request body too large",
      });
    }
  });
});
