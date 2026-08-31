import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/profile/route";
import { GET as getCheckins } from "@/app/api/profile/checkins/route";
import { GET as getCafes } from "@/app/api/profile/cafes/route";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  getProfile,
  getUserStats,
  updateProfile,
  getUserCheckIns,
  getUserCafes,
} from "@/lib/db/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/get-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/db/profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/profile")>();
  return {
    ...actual,
    getProfile: vi.fn(),
    getUserStats: vi.fn(),
    updateProfile: vi.fn(),
    getUserCheckIns: vi.fn(),
    getUserCafes: vi.fn(),
  };
});

vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 }),
  };
});

describe("Profile API routes", () => {
  const userId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(getProfile).mockReset();
    vi.mocked(getUserStats).mockReset();
    vi.mocked(updateProfile).mockReset();
    vi.mocked(getUserCheckIns).mockReset();
    vi.mocked(getUserCafes).mockReset();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now(), retryAfter: 0 });
  });

  describe("GET /api/profile", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
      const req = new Request("http://localhost/api/profile") as NextRequest;
      const res = await GET(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("unauthorized");
    });

    it("returns profile and stats for authenticated user", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(getProfile).mockResolvedValueOnce({
        id: userId,
        displayName: "Nomad Alex",
        avatarUrl: null,
        currentCity: "singapore",
        createdAt: "2026-08-25T10:00:00.000Z",
      });
      vi.mocked(getUserStats).mockResolvedValueOnce({
        cafesCount: 5,
        checkinsCount: 12,
      });

      const req = new Request("http://localhost/api/profile") as NextRequest;
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.profile.displayName).toBe("Nomad Alex");
      expect(body.stats.cafesCount).toBe(5);
      expect(body.stats.checkinsCount).toBe(12);
    });

    it("returns 404 if profile row not found", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(getProfile).mockResolvedValueOnce(null);
      vi.mocked(getUserStats).mockResolvedValueOnce({ cafesCount: 0, checkinsCount: 0 });

      const req = new Request("http://localhost/api/profile") as NextRequest;
      const res = await GET(req);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("profile_not_found");
    });
  });

  describe("PATCH /api/profile", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
      const req = new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "New Name" }),
      }) as NextRequest;
      const res = await PATCH(req);
      expect(res.status).toBe(401);
    });

    it("validates displayName length", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      const req = new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "A".repeat(25) }),
      }) as NextRequest;
      const res = await PATCH(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("display_name_length");
    });

    it("validates city is a valid launch city", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      const req = new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentCity: "atlantis" }),
      }) as NextRequest;
      const res = await PATCH(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_current_city");
    });

    it("rejects cross-origin mutating requests", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      const req = new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.com",
          Host: "localhost",
        },
        body: JSON.stringify({ displayName: "Valid Name" }),
      }) as NextRequest;
      const res = await PATCH(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("forbidden_origin");
    });

    it("updates and returns updated profile", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(updateProfile).mockResolvedValueOnce({
        id: userId,
        displayName: "Valid Name",
        avatarUrl: null,
        currentCity: "tokyo",
        createdAt: "2026-08-25T10:00:00.000Z",
      });

      const req = new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Valid Name", currentCity: "tokyo" }),
      }) as NextRequest;

      const res = await PATCH(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.profile.displayName).toBe("Valid Name");
      expect(body.profile.currentCity).toBe("tokyo");
    });
  });

  describe("GET /api/profile/checkins", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
      const req = new Request("http://localhost/api/profile/checkins") as NextRequest;
      const res = await getCheckins(req);
      expect(res.status).toBe(401);
    });

    it("returns check-ins list with next_cursor", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(getUserCheckIns).mockResolvedValueOnce({
        items: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            cafeId: "00000000-0000-4000-8000-000000000020",
            cafeName: "Kiosk",
            cafeCity: "singapore",
            cafeIsDeleted: false,
            visitedAt: "2026-08-25T12:00:00.000Z",
            scores: { wifi: 85 },
            maxStay: null,
            likesCount: 3,
            notes: "Great spot",
            photos: [],
            isCreation: true,
          },
        ],
        nextCursor: "2026-08-25T12:00:00.000Z_00000000-0000-4000-8000-000000000010",
      });

      const req = new Request("http://localhost/api/profile/checkins?limit=10") as NextRequest;
      const res = await getCheckins(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].cafeName).toBe("Kiosk");
      expect(body.next_cursor).toBe("2026-08-25T12:00:00.000Z_00000000-0000-4000-8000-000000000010");
    });

    it("returns 400 on invalid cursor", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      const { ProfileCursorError } = await import("@/lib/db/profile");
      vi.mocked(getUserCheckIns).mockRejectedValueOnce(new ProfileCursorError());

      const req = new Request("http://localhost/api/profile/checkins?cursor=bad_cursor") as NextRequest;
      const res = await getCheckins(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_cursor");
    });
  });

  describe("GET /api/profile/cafes", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
      const req = new Request("http://localhost/api/profile/cafes") as NextRequest;
      const res = await getCafes(req);
      expect(res.status).toBe(401);
    });

    it("returns 400 on invalid cursor", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      const { ProfileCursorError } = await import("@/lib/db/profile");
      vi.mocked(getUserCafes).mockRejectedValueOnce(new ProfileCursorError());

      const req = new Request("http://localhost/api/profile/cafes?cursor=bad_cursor") as NextRequest;
      const res = await getCafes(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_cursor");
    });

    it("returns cafes list with checkinsCount and isCreation", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(getUserCafes).mockResolvedValueOnce({
        items: [
          {
            id: "00000000-0000-4000-8000-000000000020",
            name: "Kiosk Roastery",
            city: "singapore",
            cover: "cafes/cover.webp",
            lastVisitedAt: "2026-08-25T12:00:00.000Z",
            checkinsCount: 2,
            isCreation: true,
          },
        ],
        nextCursor: null,
      });

      const req = new Request("http://localhost/api/profile/cafes") as NextRequest;
      const res = await getCafes(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items.length).toBe(1);
      expect(body.items[0].name).toBe("Kiosk Roastery");
      expect(body.items[0].checkinsCount).toBe(2);
      expect(body.items[0].isCreation).toBe(true);
    });
  });

  describe("rate limiting", () => {
    it("GET /api/profile returns 429 when profile-read bucket trips", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000, retryAfter: 60 });
      const req = new Request("http://localhost/api/profile") as NextRequest;
      const res = await GET(req);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
    });

    it("PATCH /api/profile returns 429 when profile-write bucket trips", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000, retryAfter: 60 });
      const req = new Request("http://localhost/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "New" }),
      }) as NextRequest;
      const res = await PATCH(req);
      expect(res.status).toBe(429);
    });

    it("GET /api/profile/checkins returns 429 when profile-read bucket trips", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000, retryAfter: 60 });
      const req = new Request("http://localhost/api/profile/checkins") as NextRequest;
      const res = await getCheckins(req);
      expect(res.status).toBe(429);
    });

    it("GET /api/profile/cafes returns 429 when profile-read bucket trips", async () => {
      vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: userId });
      vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 60000, retryAfter: 60 });
      const req = new Request("http://localhost/api/profile/cafes") as NextRequest;
      const res = await getCafes(req);
      expect(res.status).toBe(429);
    });
  });
});
