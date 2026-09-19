import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/onboarding/locate/route";
import { getCurrentUser } from "@/lib/auth/get-user";
import { updateProfile } from "@/lib/db/profile";
import { checkRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/db/profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/profile")>();
  return { ...actual, updateProfile: vi.fn() };
});

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    checkRateLimit: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 }),
  };
});

function locateRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/onboarding/locate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding/locate (DG121/DG122)", () => {
  const userId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(updateProfile).mockReset();
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now(),
      retryAfter: 0,
    });
  });

  it("rejects malformed and out-of-range coordinates", async () => {
    for (const body of [
      null,
      "x",
      { lat: "1.3", lng: 103.8 },
      { lat: 91, lng: 0 },
      { lat: 1.3, lng: 181 },
      { lat: NaN, lng: 0 },
    ]) {
      const res = await POST(locateRequest(body));
      expect(res.status).toBe(400);
    }
  });

  it("resolves an in-coverage grant to the nearest launch city", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await POST(locateRequest({ lat: 1.29, lng: 103.85 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inCoverage).toBe(true);
    expect(body.city.id).toBe("singapore");
    expect(body.city.runtime).toBe(false);
    // Anonymous callers get resolution only — no profile write.
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("creates a runtime city from cf-ipcity when out of coverage (DG121)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await POST(
      locateRequest({ lat: 38.72, lng: -9.14 }, { "cf-ipcity": "Lisbon" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inCoverage).toBe(false);
    expect(body.city.runtime).toBe(true);
    expect(body.city.id).toBe("lisbon");
    expect(body.city.name).toBe("Lisbon");
    expect(body.city.tz).toBe("Europe/Lisbon");
    expect(body.city.center).toEqual({ lat: 38.72, lng: -9.14 });
  });

  it("returns null city when out of coverage and IP detection has no name", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const res = await POST(locateRequest({ lat: 38.72, lng: -9.14 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inCoverage).toBe(false);
    expect(body.city).toBeNull();
  });

  it("persists onboarded + lastLocation + currentCity for signed-in users", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfile).mockResolvedValueOnce({
      id: userId,
      displayName: "Test User",
      avatarUrl: null,
      currentCity: "singapore",
      lastLocation: { lat: 1.29, lng: 103.85 },
      onboarded: true,
      createdAt: new Date().toISOString(),
      showPublicIdentity: false,
      publicHandle: null,
      identityConsentedAt: null,
      publicHandleChangedAt: null,
    });
    const res = await POST(locateRequest({ lat: 1.29, lng: 103.85 }));
    expect(res.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith(userId, {
      onboarded: true,
      lastLocation: { lat: 1.29, lng: 103.85 },
      currentCity: "singapore",
    });
  });

  it("returns 404 when the profile row is missing instead of 200", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
    vi.mocked(updateProfile).mockResolvedValueOnce(null);
    const res = await POST(locateRequest({ lat: 1.29, lng: 103.85 }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("profile_not_found");
  });

  it("returns 429 when the onboarding bucket trips", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      retryAfter: 60,
    });
    const res = await POST(locateRequest({ lat: 1.29, lng: 103.85 }));
    expect(res.status).toBe(429);
  });

  it("rejects cross-site requests", async () => {
    const res = await POST(
      locateRequest(
        { lat: 1.29, lng: 103.85 },
        { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      ),
    );
    expect(res.status).toBe(403);
  });
});
