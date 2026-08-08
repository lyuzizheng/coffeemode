import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";
import { toggleCheckInLike } from "@/lib/db/checkins";

const mockClientQuery = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock("@/lib/db/postgres", () => ({
  withTransaction: (fn: (client: PoolClient) => Promise<unknown>) => mockWithTransaction(fn),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mockClientQuery.mockReset();
  mockWithTransaction.mockImplementation(async (fn: (client: PoolClient) => Promise<unknown>) => {
    return fn({ query: mockClientQuery } as unknown as PoolClient);
  });
});

describe("toggleCheckInLike", () => {
  it("throws for an invalid user id", async () => {
    await expect(toggleCheckInLike("not-a-uuid", "123e4567-e89b-12d3-a456-426614174000")).rejects.toThrow(
      /Invalid user or check-in ID/,
    );
  });

  it("throws for an invalid check-in id", async () => {
    await expect(toggleCheckInLike("123e4567-e89b-12d3-a456-426614174000", "not-a-uuid")).rejects.toThrow(
      /Invalid user or check-in ID/,
    );
  });

  it("returns liked=true with the updated count when a like is inserted", async () => {
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ likes_count: 7, deleted_count: 0, inserted_count: 1 }],
    });

    const result = await toggleCheckInLike(
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "123e4567-e89b-12d3-a456-426614174000",
    );

    expect(result).toEqual({ liked: true, likesCount: 7 });
    expect(mockClientQuery).toHaveBeenCalledOnce();
    const [sql, params] = mockClientQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM checkin_likes");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("FOR UPDATE");
    expect(params).toEqual([
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "123e4567-e89b-12d3-a456-426614174000",
    ]);
  });

  it("returns liked=false with the updated count when a like is removed", async () => {
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ likes_count: 4, deleted_count: 1, inserted_count: 0 }],
    });

    const result = await toggleCheckInLike(
      "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      "123e4567-e89b-12d3-a456-426614174000",
    );

    expect(result).toEqual({ liked: false, likesCount: 4 });
  });

  it("throws when the check-in does not exist or is soft-deleted", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      toggleCheckInLike(
        "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "123e4567-e89b-12d3-a456-426614174000",
      ),
    ).rejects.toThrow(/Check-in not found or deleted/);
  });
});
