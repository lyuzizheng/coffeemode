import { beforeEach, describe, expect, it, vi } from "vitest";
import { CafeNotFoundError } from "@/lib/db/checkins";
import { parseNavigationBody, recordNavigation } from "@/lib/db/navigations";
import { POST as navPOST } from "@/app/api/navigations/route";

const getUserMock = vi.fn();
const clientQueryMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: getUserMock } }),
  isAuthConfigured: () => true,
}));

vi.mock("@/lib/db/postgres", () => ({
  withTransaction: (fn: (client: { query: typeof clientQueryMock }) => unknown) =>
    fn({ query: clientQueryMock }),
  query: (...args: unknown[]) => poolQueryMock(...args),
}));

const USER = { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" };
const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const NAV_ROW = {
  id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
  resolved: false,
  created_at: "2026-08-17T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  getUserMock.mockResolvedValue({ data: { user: USER }, error: null });
});

describe("parseNavigationBody", () => {
  it("accepts a valid cafe_id and rejects everything else", () => {
    expect(parseNavigationBody({ cafe_id: CAFE }).ok).toBe(true);
    expect(parseNavigationBody(null).ok).toBe(false);
    expect(parseNavigationBody({}).ok).toBe(false);
    expect(parseNavigationBody({ cafe_id: "nope" }).ok).toBe(false);
  });
});

describe("recordNavigation", () => {
  it("inserts the row after verifying the cafe exists", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // cafe exists
      .mockResolvedValueOnce({ rows: [NAV_ROW] }); // insert

    const result = await recordNavigation(USER.id, CAFE);

    expect(result).toEqual(NAV_ROW);
    const insert = poolQueryMock.mock.calls[1];
    expect(insert[0]).toContain("insert into navigations");
    expect(insert[1]).toEqual([CAFE, USER.id]);
  });

  it("throws CafeNotFoundError without inserting when the cafe is missing", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });

    const err = await recordNavigation(USER.id, CAFE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CafeNotFoundError);
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid ids before touching the database", async () => {
    await expect(recordNavigation("not-a-uuid", CAFE)).rejects.toThrow("Invalid user ID");
    await expect(recordNavigation(USER.id, "nope")).rejects.toThrow("Invalid cafe ID");
    expect(poolQueryMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/navigations", () => {
  const url = "https://localhost/api/navigations";

  function postRequest(body: unknown): Request {
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("400s on an invalid body before checking auth", async () => {
    getUserMock.mockClear();
    const res = await navPOST(postRequest({}));
    expect(res.status).toBe(400);
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await navPOST(postRequest({ cafe_id: CAFE }));
    expect(res.status).toBe(401);
  });

  it("404s when the cafe does not exist", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await navPOST(postRequest({ cafe_id: CAFE }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("201s with the recorded navigation", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] })
      .mockResolvedValueOnce({ rows: [NAV_ROW] });
    const res = await navPOST(postRequest({ cafe_id: CAFE }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ id: NAV_ROW.id, resolved: false });
  });
});
