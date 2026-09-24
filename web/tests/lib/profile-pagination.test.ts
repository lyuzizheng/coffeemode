import { describe, expect, it } from "vitest";
import { paginateProfileRows, parseProfileCursor } from "@/lib/db/profile/cursor";

const row = (id: string, ts: string) => ({
  cursor_visited_at: ts,
  id,
});

describe("paginateProfileRows — shared keyset tail (OPT-2)", () => {
  it("trims the limit+1 probe row and issues the last page row's cursor", () => {
    const rows = [
      row("11111111-1111-4111-8111-111111111111", "2026-09-20T10:00:00.123456Z"),
      row("22222222-2222-4222-8222-222222222222", "2026-09-19T10:00:00.123456Z"),
      row("33333333-3333-4333-8333-333333333333", "2026-09-18T10:00:00.123456Z"),
    ];
    const { page, next_cursor } = paginateProfileRows(rows, 2);

    expect(page.map((r) => r.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(next_cursor).toBe(
      "2026-09-19T10:00:00.123456Z_22222222-2222-4222-8222-222222222222",
    );
    // Issued cursor decodes with the same parser the queries consume.
    expect(parseProfileCursor(next_cursor!)).toEqual({
      visitedAt: "2026-09-19T10:00:00.123456Z",
      id: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("returns all rows with a null cursor when the page is exhausted", () => {
    const rows = [row("11111111-1111-4111-8111-111111111111", "2026-09-20T10:00:00.123456Z")];
    const { page, next_cursor } = paginateProfileRows(rows, 2);

    expect(page).toEqual(rows);
    expect(next_cursor).toBeNull();
  });

  it("returns an empty page with a null cursor for empty results", () => {
    const { page, next_cursor } = paginateProfileRows([], 2);

    expect(page).toEqual([]);
    expect(next_cursor).toBeNull();
  });
});
