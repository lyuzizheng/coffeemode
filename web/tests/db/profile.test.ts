import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQueryMock = vi.fn();

vi.mock("@/lib/db/postgres", () => ({
  query: (...args: unknown[]) => poolQueryMock(...args),
}));

import {
  getProfile,
  getUserStats,
  updateProfile,
  getUserCheckIns,
  getUserCafes,
} from "@/lib/db/profile";

describe("Profile DB helpers", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const invalidId = "not-a-uuid";

  beforeEach(() => {
    poolQueryMock.mockReset();
  });

  describe("getProfile", () => {
    it("returns null for invalid uuid", async () => {
      expect(await getProfile(invalidId)).toBeNull();
      expect(poolQueryMock).not.toHaveBeenCalled();
    });

    it("returns mapped DTO on hit", async () => {
      poolQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: userId,
            display_name: "Nomad Alex",
            avatar_url: null,
            current_city: "tokyo",
            created_at: new Date("2026-08-25T10:00:00.000Z"),
          },
        ],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const profile = await getProfile(userId);
      expect(profile).toEqual({
        id: userId,
        displayName: "Nomad Alex",
        avatarUrl: null,
        currentCity: "tokyo",
        createdAt: "2026-08-25T10:00:00.000Z",
      });
    });
  });

  describe("getUserStats", () => {
    it("returns zeros for invalid uuid", async () => {
      expect(await getUserStats(invalidId)).toEqual({ cafesCount: 0, checkinsCount: 0 });
    });

    it("parses count rows correctly", async () => {
      poolQueryMock.mockResolvedValueOnce({
        rows: [
          {
            cafes_count: "4",
            checkins_count: "9",
          },
        ],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const stats = await getUserStats(userId);
      expect(stats).toEqual({ cafesCount: 4, checkinsCount: 9 });
    });
  });

  describe("updateProfile", () => {
    it("returns null for invalid uuid", async () => {
      expect(await updateProfile(invalidId, { displayName: "Valid" })).toBeNull();
    });

    it("updates display_name and returns updated DTO", async () => {
      poolQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: userId,
            display_name: "New Name",
            avatar_url: null,
            current_city: "singapore",
            created_at: new Date("2026-08-25T10:00:00.000Z"),
          },
        ],
        command: "UPDATE",
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const updated = await updateProfile(userId, { displayName: "New Name" });
      expect(updated?.displayName).toBe("New Name");
    });
  });

  describe("getUserCheckIns", () => {
    it("returns empty list for invalid uuid", async () => {
      const res = await getUserCheckIns(invalidId);
      expect(res).toEqual({ items: [], nextCursor: null });
    });

    it("maps items and generates nextCursor when hasMore", async () => {
      const visitedAt = new Date("2026-08-25T12:00:00.000Z");
      const checkinId1 = "00000000-0000-4000-8000-000000000011";
      const checkinId2 = "00000000-0000-4000-8000-000000000012";

      poolQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: checkinId1,
            cafe_id: "00000000-0000-4000-8000-000000000021",
            cafe_name: "Cafe 1",
            cafe_city: "singapore",
            cafe_is_deleted: false,
            visited_at: visitedAt,
            scores: { wifi: 90 },
            likes_count: 5,
            notes: "Note",
            photos: [],
            is_creation: false,
          },
          {
            id: checkinId2,
            cafe_id: "00000000-0000-4000-8000-000000000022",
            cafe_name: "Cafe 2",
            cafe_city: "singapore",
            cafe_is_deleted: true,
            visited_at: visitedAt,
            scores: {},
            likes_count: 0,
            notes: null,
            photos: null,
            is_creation: true,
          },
        ],
        command: "SELECT",
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      const res = await getUserCheckIns(userId, { limit: 1 });
      expect(res.items.length).toBe(1);
      expect(res.items[0].cafeName).toBe("Cafe 1");
      expect(res.nextCursor).toBe(`${visitedAt.toISOString()}_${checkinId1}`);
    });
  });

  describe("getUserCafes", () => {
    it("maps distinct visited cafes with isCreation", async () => {
      const lastVisited = new Date("2026-08-25T14:00:00.000Z");
      const cafeId = "00000000-0000-4000-8000-000000000031";

      poolQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: cafeId,
            name: "My Roastery",
            city: "singapore",
            cover: "cover.webp",
            last_visited_at: lastVisited,
            checkins_count: "3",
            is_creation: true,
          },
        ],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      const res = await getUserCafes(userId, { limit: 10 });
      expect(res.items.length).toBe(1);
      expect(res.items[0].name).toBe("My Roastery");
      expect(res.items[0].checkinsCount).toBe(3);
      expect(res.items[0].isCreation).toBe(true);
      expect(res.nextCursor).toBeNull();
    });
  });
});
