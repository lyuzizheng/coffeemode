import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const txQueryMock = vi.fn();

vi.mock("@/lib/db/postgres", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  // Run the transaction body against a recording client — the assertions
  // below are about statement order/content, not real Postgres.
  withTransaction: (fn: (client: { query: typeof txQueryMock }) => Promise<unknown>) =>
    fn({ query: txQueryMock }),
  txRunnerFrom: () => async () => undefined,
}));

vi.mock("@/lib/stats/aggregate", () => ({
  recomputeWorkStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/cafes/meta", () => ({
  getServiceAccountId: () => "00000000-0000-4000-a000-000000000001",
}));

import { deleteAccount, getProfileExport } from "@/lib/db/profile";

const USER = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

const emptyResult = { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };

describe("deleteAccount", () => {
  beforeEach(() => {
    queryMock.mockReset();
    txQueryMock.mockReset();
  });

  it("detaches checkins.user_id before deleting the profile row", async () => {
    // One live check-in on one cafe — the FK-blocked path from review.
    txQueryMock.mockImplementation((sql: string) => {
      if (sql.includes("from checkins where user_id")) {
        return Promise.resolve({
          ...emptyResult,
          rows: [{ id: "c1", cafe_id: "k1" }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ ...emptyResult, rowCount: 1 });
    });

    const result = await deleteAccount(USER);
    expect(result.ok).toBe(true);

    const statements = txQueryMock.mock.calls.map(([sql]) => sql as string);
    const detachIdx = statements.findIndex((s) =>
      s.includes("update checkins set user_id = null"),
    );
    const profileDeleteIdx = statements.findIndex((s) =>
      s.includes("delete from profiles"),
    );
    expect(detachIdx).toBeGreaterThan(-1);
    expect(profileDeleteIdx).toBeGreaterThan(-1);
    // checkins.user_id → profiles(id) has no ON DELETE clause: the detach
    // must land before the profile delete or the FK rolls the tx back.
    expect(detachIdx).toBeLessThan(profileDeleteIdx);
  });

  it("rejects an invalid user id without touching the database", async () => {
    await expect(deleteAccount("not-a-uuid")).rejects.toThrow("invalid user id");
    expect(txQueryMock).not.toHaveBeenCalled();
  });
});

describe("getProfileExport", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue(emptyResult);
  });

  it("queries real columns only (note, geography projection, navigation queue fields)", async () => {
    await getProfileExport(USER);
    const sql = queryMock.mock.calls.map(([s]) => s as string).join("\n");
    // Regression pins for the review findings: the export 500'd on
    // checkins.notes, navigations.resolved_at, and cafes.lat/lng.
    expect(sql).toContain("max_stay, note, photos");
    expect(sql).not.toContain("notes");
    expect(sql).toContain("ST_Y(location::geometry) as lat");
    expect(sql).toContain("ST_X(location::geometry) as lng");
    expect(sql).not.toContain("resolved_at");
    expect(sql).toContain("outcome, ask_count, last_asked_at");
  });

  it("returns a null profile for an unknown user", async () => {
    const bundle = await getProfileExport(USER);
    expect(bundle.profile).toBeNull();
    expect(bundle.checkins).toEqual([]);
    expect(bundle.cafes_created).toEqual([]);
    expect(bundle.navigations).toEqual([]);
    expect(typeof bundle.exported_at).toBe("string");
  });
});
