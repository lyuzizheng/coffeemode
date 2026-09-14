import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as heartbeatGET } from "@/app/api/heartbeat/route";
import { GET as configGET } from "@/app/api/config/route";
import { checkRateLimit } from "@/lib/rate-limit";
import { pingDatabase } from "@/lib/db/heartbeat";
import { getRuntimeConfig } from "@/lib/db/runtime-config";

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

vi.mock("@/lib/db/heartbeat", () => ({
  pingDatabase: vi.fn(),
}));

vi.mock("@/lib/db/runtime-config", () => ({
  getRuntimeConfig: vi.fn(),
}));

describe("GET /api/heartbeat (BRAWUKA-284)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 });
    vi.mocked(pingDatabase).mockResolvedValue(undefined);
  });

  it("returns 200 with env/db/ts and really touches the database", async () => {
    const res = await heartbeatGET(new Request("http://localhost/api/heartbeat"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("up");
    expect(typeof body.env).toBe("string");
    expect(typeof body.ts).toBe("string");
    expect(Number.isNaN(Date.parse(body.ts))).toBe(false);
    expect(pingDatabase).toHaveBeenCalledTimes(1);
  });

  it("carries no secrets in the response", async () => {
    const res = await heartbeatGET(new Request("http://localhost/api/heartbeat"));
    const raw = await res.text();
    expect(raw).not.toMatch(/postgres|supabase|secret|token|key|password/i);
  });

  it("returns 503 when the database is unreachable", async () => {
    vi.mocked(pingDatabase).mockRejectedValueOnce(new Error("down"));
    const res = await heartbeatGET(new Request("http://localhost/api/heartbeat"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("db_unavailable");
  });

  it("returns 429 when the heartbeat bucket trips", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
    });
    const res = await heartbeatGET(new Request("http://localhost/api/heartbeat"));
    expect(res.status).toBe(429);
    expect(pingDatabase).not.toHaveBeenCalled();
  });
});

describe("GET /api/config (BRAWUKA-284)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 });
    vi.mocked(getRuntimeConfig).mockResolvedValue({
      flags: { new_search: true },
      banners: [
        { id: "m1", kind: "maintenance", text: { en: "Down Sunday", zh: "周日维护" } },
      ],
    });
  });

  it("returns flags + banners with the 60s edge-cache header", async () => {
    const res = await configGET(new Request("http://localhost/api/config"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      flags: { new_search: true },
      banners: [{ id: "m1", kind: "maintenance", text: { en: "Down Sunday", zh: "周日维护" } }],
    });
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("carries no secrets in the response", async () => {
    const res = await configGET(new Request("http://localhost/api/config"));
    const raw = await res.text();
    expect(raw).not.toMatch(/postgres|supabase|secret|token|key|password/i);
  });

  it("returns 500 when the database is unreachable", async () => {
    vi.mocked(getRuntimeConfig).mockRejectedValueOnce(new Error("down"));
    const res = await configGET(new Request("http://localhost/api/config"));
    expect(res.status).toBe(500);
  });
});
