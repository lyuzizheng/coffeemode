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

  });

  describe("getUserCheckIns", () => {
    it("returns empty list for invalid uuid", async () => {
      const res = await getUserCheckIns(invalidId);
      expect(res).toEqual({ items: [], next_cursor: null });
    });

    it("maps items and generates next_cursor when hasMore", async () => {
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
            cursor_visited_at: "2026-08-25T12:00:00.123456Z",
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
            cursor_visited_at: "2026-08-25T12:00:00.123457Z",
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
      expect(res.items[0].cafe_name).toBe("Cafe 1");
      // Microsecond-precision cursor comes from SQL to_char, not the
      // ms-truncated JS Date (BRAWUKA-315).
      expect(res.next_cursor).toBe(`2026-08-25T12:00:00.123456Z_${checkinId1}`);
    });

    it("round-trips a microsecond cursor through the next page (BRAWUKA-315)", async () => {
      const visitedAt = new Date("2026-08-25T12:00:00.123Z");
      const checkinId = "00000000-0000-4000-8000-000000000011";
      poolQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: checkinId,
            cafe_id: "00000000-0000-4000-8000-000000000021",
            cafe_name: "Cafe 1",
            cafe_city: "singapore",
            cafe_is_deleted: false,
            visited_at: visitedAt,
            cursor_visited_at: "2026-08-25T12:00:00.123456Z",
            scores: {},
            likes_count: 0,
            notes: null,
            photos: [],
            is_creation: false,
          },
        ],
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
      });

      await getUserCheckIns(userId, {
        limit: 1,
        cursor: `2026-08-25T12:00:00.123455Z_00000000-0000-4000-8000-000000000010`,
      });
      const [, params] = poolQueryMock.mock.calls[0] as [string, unknown[]];
      expect(params).toContain("2026-08-25T12:00:00.123455Z");
    });

    it("throws ProfileCursorError on invalid cursor string", async () => {
      await expect(getUserCheckIns(userId, { cursor: "invalid_cursor" })).rejects.toThrow();
      await expect(getUserCheckIns(userId, { cursor: "not-a-date_00000000-0000-4000-8000-000000000001" })).rejects.toThrow();
      await expect(getUserCheckIns(userId, { cursor: "2026-08-25T12:00:00.000Z_not-a-uuid" })).rejects.toThrow();
      await expect(getUserCheckIns(userId, { cursor: "2026-08-25T12:00:00.000Z_00000000-0000-4000-8000-000000000001_extra" })).rejects.toThrow();
    });
  });

  describe("getUserCafes", () => {
    it("throws ProfileCursorError on invalid cursor string", async () => {
      await expect(getUserCafes(userId, { cursor: "invalid_cursor" })).rejects.toThrow();
      await expect(getUserCafes(userId, { cursor: "not-a-date_00000000-0000-4000-8000-000000000001" })).rejects.toThrow();
      await expect(getUserCafes(userId, { cursor: "2026-08-25T12:00:00.000Z_not-a-uuid" })).rejects.toThrow();
      await expect(getUserCafes(userId, { cursor: "2026-08-25T12:00:00.000Z_00000000-0000-4000-8000-000000000001_extra" })).rejects.toThrow();
    });

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
      expect(res.items[0].checkins_count).toBe(3);
      expect(res.items[0].is_creation).toBe(true);
      expect(res.next_cursor).toBeNull();
    });

    it("emits a microsecond-precision next_cursor when paginating (BRAWUKA-315)", async () => {
      const lastVisited = new Date("2026-08-25T14:00:00.000Z");
      const cafeId1 = "00000000-0000-4000-8000-000000000031";
      const cafeId2 = "00000000-0000-4000-8000-000000000032";
      poolQueryMock.mockResolvedValueOnce({
        rows: [
          {
            id: cafeId1,
            name: "First",
            city: "singapore",
            cover: null,
            last_visited_at: lastVisited,
            cursor_visited_at: "2026-08-25T14:00:00.654321Z",
            checkins_count: "2",
            is_creation: false,
          },
          {
            id: cafeId2,
            name: "Second",
            city: "singapore",
            cover: null,
            last_visited_at: lastVisited,
            cursor_visited_at: "2026-08-25T14:00:00.654320Z",
            checkins_count: "1",
            is_creation: false,
          },
        ],
        command: "SELECT",
        rowCount: 2,
        oid: 0,
        fields: [],
      });

      const res = await getUserCafes(userId, { limit: 1 });
      expect(res.items.length).toBe(1);
      expect(res.next_cursor).toBe(`2026-08-25T14:00:00.654321Z_${cafeId1}`);
    });
  });
});
