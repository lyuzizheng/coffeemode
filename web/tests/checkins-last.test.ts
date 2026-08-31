import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as lastCheckinGET } from "@/app/api/checkins/last/route";

const getUserMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: getUserMock } }),
  isAuthConfigured: () => true,
}));

vi.mock("@/lib/db/postgres", () => ({
  query: (...args: unknown[]) => poolQueryMock(...args),
}));

const USER = { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" };
const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

function getRequest(url: string) {
  return new NextRequest(new URL(url));
}

describe("GET /api/checkins/last", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: USER }, error: null });
  });

  it("401s without a session, before touching the database", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await lastCheckinGET(getRequest(`https://localhost/api/checkins/last?cafe_id=${CAFE}`));
    expect(res.status).toBe(401);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it("400s when cafe_id is missing or not a UUID", async () => {
    for (const url of [
      "https://localhost/api/checkins/last",
      "https://localhost/api/checkins/last?cafe_id=not-a-uuid",
    ]) {
      const res = await lastCheckinGET(getRequest(url));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
    }
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it("200s with checkin null when the user never checked in here", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await lastCheckinGET(getRequest(`https://localhost/api/checkins/last?cafe_id=${CAFE}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ checkin: null });
  });

  it("200s with the most recent check-in row", async () => {
    const row = {
      id: CHECKIN,
      scores: { wifi: 80, overall: 90 },
      max_stay: "3h",
      note: "Great corner seat",
      visited_at: "2026-08-20T10:00:00.000Z",
    };
    poolQueryMock.mockResolvedValueOnce({ rows: [row] });
    const res = await lastCheckinGET(getRequest(`https://localhost/api/checkins/last?cafe_id=${CAFE}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ checkin: row });
    // The helper must scope to the caller and the requested cafe.
    expect(poolQueryMock).toHaveBeenCalledWith(expect.any(String), [USER.id, CAFE]);
  });
});
