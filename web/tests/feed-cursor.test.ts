import { describe, expect, it } from "vitest";
import {
  FeedCursorError,
  decodeFeedCursor,
  encodeFeedCursor,
  listPublicCheckIns,
} from "@/lib/discovery/feed";

const ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";
const VISITED = "2026-08-20T10:00:00.000Z";

describe("feed cursor encode/decode", () => {
  it("round-trips a newest cursor", () => {
    const raw = encodeFeedCursor({ v: 1, mode: "newest", visited_at: VISITED, id: ID });
    expect(decodeFeedCursor(raw, "newest")).toEqual({
      v: 1,
      mode: "newest",
      visited_at: VISITED,
      id: ID,
    });
  });

  it("round-trips a helpful cursor with likes", () => {
    const raw = encodeFeedCursor({
      v: 1,
      mode: "helpful",
      likes: 7,
      visited_at: VISITED,
      id: ID,
    });
    expect(decodeFeedCursor(raw, "helpful")).toEqual({
      v: 1,
      mode: "helpful",
      likes: 7,
      visited_at: VISITED,
      id: ID,
    });
  });

  it("is URL-safe (base64url, no padding/plus/slash)", () => {
    const raw = encodeFeedCursor({
      v: 1,
      mode: "helpful",
      likes: 12345,
      visited_at: VISITED,
      id: ID,
    });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a cursor issued for another mode", () => {
    const raw = encodeFeedCursor({ v: 1, mode: "newest", visited_at: VISITED, id: ID });
    expect(() => decodeFeedCursor(raw, "helpful")).toThrow(FeedCursorError);
  });

  it("rejects garbage, wrong version, bad id, and bad visited_at", () => {
    expect(() => decodeFeedCursor("not-base64!!!", "newest")).toThrow(FeedCursorError);
    const badVersion = Buffer.from(
      JSON.stringify({ v: 2, mode: "newest", visited_at: VISITED, id: ID }),
    ).toString("base64url");
    expect(() => decodeFeedCursor(badVersion, "newest")).toThrow(FeedCursorError);
    const badId = Buffer.from(
      JSON.stringify({ v: 1, mode: "newest", visited_at: VISITED, id: "nope" }),
    ).toString("base64url");
    expect(() => decodeFeedCursor(badId, "newest")).toThrow(FeedCursorError);
    const badDate = Buffer.from(
      JSON.stringify({ v: 1, mode: "newest", visited_at: "not-a-date", id: ID }),
    ).toString("base64url");
    expect(() => decodeFeedCursor(badDate, "newest")).toThrow(FeedCursorError);
  });

  it("requires a non-negative integer likes on helpful cursors", () => {
    const missing = Buffer.from(
      JSON.stringify({ v: 1, mode: "helpful", visited_at: VISITED, id: ID }),
    ).toString("base64url");
    expect(() => decodeFeedCursor(missing, "helpful")).toThrow(FeedCursorError);
    const negative = Buffer.from(
      JSON.stringify({ v: 1, mode: "helpful", likes: -1, visited_at: VISITED, id: ID }),
    ).toString("base64url");
    expect(() => decodeFeedCursor(negative, "helpful")).toThrow(FeedCursorError);
    const fractional = Buffer.from(
      JSON.stringify({ v: 1, mode: "helpful", likes: 1.5, visited_at: VISITED, id: ID }),
    ).toString("base64url");
    expect(() => decodeFeedCursor(fractional, "helpful")).toThrow(FeedCursorError);
  });

  describe("listPublicCheckIns invalid cafeId guard", () => {
    it("returns empty result without querying db when cafeId is not a UUID", async () => {
      const result = await listPublicCheckIns({
        cafeId: "invalid-cafe-id",
        mode: "newest",
        viewerId: null,
      });
      expect(result).toEqual({ checkins: [], nextCursor: null });
    });
  });
});
