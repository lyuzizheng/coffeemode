import { describe, expect, it, vi } from "vitest";
import { GET as recoveryGET } from "@/app/api/cafes/[id]/recovery/route";

const getUserMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: getUserMock } }),
  isAuthConfigured: () => true,
}));

vi.mock("@/lib/db/postgres", () => ({
  query: (...args: unknown[]) => poolQueryMock(...args),
}));

const CAFE = "550e8400-e29b-41d4-a716-446655440001";

function nearbyRow(id: string, distanceM: number) {
  return {
    id,
    slug: null,
    name: `Cafe ${id.slice(-2)}`,
    lat: 1.27,
    lng: 103.84,
    address: null,
    city: "Singapore",
    tz: "Asia/Singapore",
    opening_hours: null,
    price_range: null,
    work_stats: {},
    cover: null,
    distance_m: distanceM,
  };
}

describe("GET /api/cafes/[id]/recovery (DG111)", () => {
  it("400s on a non-UUID id", async () => {
    const res = await recoveryGET(new Request("https://localhost/api/cafes/x/recovery"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it("returns an empty list when the cafe's location is unknown", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // getCafeLocation
    const res = await recoveryGET(new Request("https://localhost/api/cafes/x/recovery"), {
      params: Promise.resolve({ id: CAFE }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ cafes: [] });
  });

  it("lists nearby cafes excluding the requested cafe, capped by recoveryLimit", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ lat: 1.27, lng: 103.84 }] }) // getCafeLocation
      // limit = recoveryLimit + 1 = 6 rows come back, including the cafe itself.
      .mockResolvedValueOnce({
        rows: [
          nearbyRow(CAFE, 0),
          nearbyRow("550e8400-e29b-41d4-a716-446655440101", 120),
          nearbyRow("550e8400-e29b-41d4-a716-446655440102", 300),
          nearbyRow("550e8400-e29b-41d4-a716-446655440103", 450),
          nearbyRow("550e8400-e29b-41d4-a716-446655440104", 600),
          nearbyRow("550e8400-e29b-41d4-a716-446655440105", 750),
        ],
      });
    const res = await recoveryGET(new Request("https://localhost/api/cafes/x/recovery"), {
      params: Promise.resolve({ id: CAFE }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cafes: Array<{ id: string }> };
    expect(body.cafes.map((c) => c.id)).toEqual([
      "550e8400-e29b-41d4-a716-446655440101",
      "550e8400-e29b-41d4-a716-446655440102",
      "550e8400-e29b-41d4-a716-446655440103",
      "550e8400-e29b-41d4-a716-446655440104",
      "550e8400-e29b-41d4-a716-446655440105",
    ]);
  });

  it("500s without leaking upstream errors", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    poolQueryMock.mockRejectedValueOnce(new Error("connection refused"));
    const res = await recoveryGET(new Request("https://localhost/api/cafes/x/recovery"), {
      params: Promise.resolve({ id: CAFE }),
    });
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "internal_error" });
  });
});
