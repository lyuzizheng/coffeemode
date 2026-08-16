import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CafeExistsError,
  createCafeWithFirstCheckIn,
  getCafe,
  listCafesNearby,
  parseCreateCafeBody,
  type CreateCafeCheckInInput,
} from "@/lib/db/cafes";
import { GET as listGET, POST as createPOST } from "@/app/api/cafes/route";
import { GET as detailGET } from "@/app/api/cafes/[id]/route";

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

const USER = { id: "550e8400-e29b-41d4-a716-446655440000" };
// Singapore — tz-lookup resolves these to Asia/Singapore (pure, no I/O).
const SG = { lat: 1.2789, lng: 103.8425 };

const SAMPLE_IMG = {
  id: "img1",
  original: "o",
  card: "c",
  thumbnail: "t",
  w: 800,
  h: 600,
  by: USER.id,
  at: "2026-08-16T00:00:00.000Z",
};

/** The spec-0001 minimum for the creator's first check-in. */
const VALID_CHECKIN = {
  scores: { wifi: 80, overall: 75 },
  min_spend: "drink",
  max_stay: "unlimited",
  note: "quiet",
  photos: [SAMPLE_IMG],
};

/** A fully valid POST body; pass checkin-level overrides to break one field. */
function validBody(checkin: Record<string, unknown> = {}) {
  return {
    name: "Caracara",
    ...SG,
    address: "77 Neil Road",
    google_place_id: "ChIJx",
    checkin: { ...VALID_CHECKIN, ...checkin },
  };
}

/** Typed lib-level input (parser output shape). */
function validCheckinInput(): CreateCafeCheckInInput {
  return {
    scores: { wifi: 80, overall: 75 },
    min_spend: "drink",
    max_stay: "unlimited",
    note: "quiet",
    photos: [SAMPLE_IMG],
  };
}

function signedIn() {
  getUserMock.mockResolvedValue({ data: { user: USER }, error: null });
}

function postRequest(body: unknown): Request {
  return new Request("https://localhost/api/cafes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Mock the statements of the happy-path create transaction + stats (7 queries). */
function mockCreateHappyPath(cafeId = "cafe-1", checkinId = "checkin-1") {
  clientQueryMock
    .mockResolvedValueOnce({ rows: [] }) // dedupe pre-check by external id
    .mockResolvedValueOnce({ rows: [{ id: cafeId }] }) // insert cafe
    .mockResolvedValueOnce({ rows: [{ id: checkinId }] }) // insert first check-in
    .mockResolvedValueOnce({ rows: [{ work_stats: {} }] }) // stats: lock + read cafe
    .mockResolvedValueOnce({ rows: [] }) // stats: user's check-ins (none in mock)
    .mockResolvedValueOnce({ rows: [{ n: 1 }] }) // stats: check-in count
    .mockResolvedValueOnce({ rows: [] }); // stats: update cafes.work_stats
}

beforeEach(() => {
  vi.resetAllMocks();
  signedIn();
});

describe("parseCreateCafeBody", () => {
  it("accepts a minimal valid body", () => {
    const parsed = parseCreateCafeBody({ name: "Kiosk", ...SG, checkin: VALID_CHECKIN });
    expect(parsed.ok).toBe(true);
  });

  it("rejects non-object, empty name, and out-of-range coordinates", () => {
    expect(parseCreateCafeBody(null).ok).toBe(false);
    expect(parseCreateCafeBody({ ...validBody(), name: " " }).ok).toBe(false);
    expect(parseCreateCafeBody({ ...validBody(), lat: 91 }).ok).toBe(false);
    expect(parseCreateCafeBody({ ...validBody(), lat: "1.2" }).ok).toBe(false);
  });

  it("rejects unknown score dimensions and out-of-range scores", () => {
    const bad = (scores: unknown) => parseCreateCafeBody(validBody({ scores }));
    expect(bad({ wifi: 101 }).ok).toBe(false);
    expect(bad({ wifi: -1 }).ok).toBe(false);
    expect(bad({ vibe: 50 }).ok).toBe(false);
    expect(bad({ wifi: 0, coffee: 100, overall: 50 }).ok).toBe(true); // boundaries inclusive
  });

  it("requires overall, min_spend, max_stay, note, and >=1 photo on creation (spec 0001)", () => {
    expect(parseCreateCafeBody(validBody({ scores: { wifi: 80 } })).ok).toBe(false); // no overall
    expect(parseCreateCafeBody(validBody({ min_spend: undefined })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ max_stay: undefined })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ note: undefined })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ note: "" })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photos: undefined })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photos: [] })).ok).toBe(false);
  });

  it("rejects malformed photo entries", () => {
    expect(parseCreateCafeBody(validBody({ photos: [{}] })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photos: [{ ...SAMPLE_IMG, w: 0 }] })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photos: [{ ...SAMPLE_IMG, at: "not-a-date" }] })).ok).toBe(
      false,
    );
  });

  it("rejects invalid policy enums and malformed opening_hours", () => {
    expect(parseCreateCafeBody(validBody({ min_spend: "free" })).ok).toBe(false);
    expect(
      parseCreateCafeBody({
        ...validBody(),
        opening_hours: { mon: { open: "9am", close: "18:00" } },
      }).ok,
    ).toBe(false);
    expect(
      parseCreateCafeBody({
        ...validBody(),
        opening_hours: { mon: { open: "09:00", close: "18:00" } },
      }).ok,
    ).toBe(true);
  });

  it("rejects an unparseable or future visited_at", () => {
    expect(parseCreateCafeBody(validBody({ visited_at: "last tuesday" })).ok).toBe(false);
    expect(
      parseCreateCafeBody(validBody({ visited_at: new Date(Date.now() + 60_000).toISOString() }))
        .ok,
    ).toBe(false);
    expect(parseCreateCafeBody(validBody({ visited_at: "2026-08-01T00:00:00.000Z" })).ok).toBe(true);
  });
});

describe("createCafeWithFirstCheckIn", () => {
  it("inserts cafe + first check-in + stats in one transaction", async () => {
    mockCreateHappyPath();
    const result = await createCafeWithFirstCheckIn(USER.id, {
      name: "Caracara",
      ...SG,
      google_place_id: "ChIJx",
      checkin: validCheckinInput(),
    });

    expect(result).toEqual({ cafeId: "cafe-1", checkinId: "checkin-1", tz: "Asia/Singapore" });

    const cafeInsert = clientQueryMock.mock.calls[1]; // [0] is the dedupe pre-check
    expect(cafeInsert[0]).toContain("insert into cafes");
    // ST_MakePoint($3, $2): params are [name, lat, lng, ...] — lng/lat order in SQL.
    expect(cafeInsert[1][1]).toBe(SG.lat);
    expect(cafeInsert[1][2]).toBe(SG.lng);
    expect(cafeInsert[1][5]).toBe("Asia/Singapore"); // tz derived from coordinates

    const checkinInsert = clientQueryMock.mock.calls[2];
    expect(checkinInsert[0]).toContain("insert into checkins");
    expect(checkinInsert[1][0]).toBe("cafe-1");
    expect(checkinInsert[0]).toContain("is_creation");
    // Required first-check-in fields land as params 3-7 (scores, policies, note, photos).
    expect(checkinInsert[1][3]).toBe("drink");
    expect(checkinInsert[1][4]).toBe("unlimited");
    expect(checkinInsert[1][5]).toBe("quiet");
    expect(checkinInsert[1][6]).toBe(JSON.stringify([SAMPLE_IMG]));

    // Stats fold ran on the SAME connection (no second transaction).
    const statsCall = clientQueryMock.mock.calls[3];
    expect(statsCall[0]).toContain("for update");
    expect(statsCall[1]).toEqual(["cafe-1"]);
  });

  it("dedupes on the pre-check without attempting an insert", async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [{ id: "existing-7" }] }); // pre-check hit

    const err = await createCafeWithFirstCheckIn(USER.id, {
      name: "Dupe",
      ...SG,
      google_place_id: "ChIJx",
      checkin: validCheckinInput(),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CafeExistsError);
    expect((err as CafeExistsError).existingCafeId).toBe("existing-7");
    expect(clientQueryMock).toHaveBeenCalledTimes(1); // no insert attempted
  });

  it("maps a lost unique-index race to CafeExistsError via a post-rollback lookup", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // pre-check misses (race window)
      .mockRejectedValueOnce({ code: "23505" }); // insert hits the unique index
    // After rollback the lookup runs on the pool, not the aborted connection.
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: "existing-9" }] });

    const err = await createCafeWithFirstCheckIn(USER.id, {
      name: "Dupe",
      ...SG,
      google_place_id: "ChIJx",
      checkin: validCheckinInput(),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CafeExistsError);
    expect((err as CafeExistsError).existingCafeId).toBe("existing-9");
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid user id before touching the database", async () => {
    await expect(
      createCafeWithFirstCheckIn("not-a-uuid", {
        name: "x",
        ...SG,
        checkin: validCheckinInput(),
      }),
    ).rejects.toThrow("Invalid user ID");
    expect(clientQueryMock).not.toHaveBeenCalled();
  });
});

describe("listCafesNearby / getCafe", () => {
  it("queries with ST_DWithin and coerces work_stats", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: "c1", distance_m: 42, work_stats: {} }] });
    const rows = await listCafesNearby({ ...SG, radiusKm: 1.5, limit: 50 });
    expect(rows[0]?.id).toBe("c1");
    // A fractional radius passes through untyped node-pg params (SQL casts to float8).
    expect(poolQueryMock.mock.calls[0][0]).toContain("ST_DWithin");
    expect(poolQueryMock.mock.calls[0][1]).toEqual([SG.lat, SG.lng, 1.5, 50]);
    // DB default '{}' becomes a complete WorkStats before reaching the UI.
    expect(rows[0]?.work_stats.n_users).toBe(0);
    expect(rows[0]?.work_stats.dims.wifi).toEqual({ sum: 0, n: 0 });
    expect(rows[0]?.work_stats.experience_score).toBeNull();
  });

  it("returns null for a missing cafe and rejects a bad uuid", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getCafe("550e8400-e29b-41d4-a716-446655440001")).resolves.toBeNull();
    await expect(getCafe("nope")).rejects.toThrow("Invalid cafe ID");
  });
});

describe("POST /api/cafes", () => {
  it("400s on an invalid body before checking auth", async () => {
    getUserMock.mockClear();
    const res = await createPOST(postRequest({ name: "" }));
    expect(res.status).toBe(400);
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await createPOST(postRequest(validBody()));
    expect(res.status).toBe(401);
  });

  it("201s with the fused create result", async () => {
    mockCreateHappyPath();
    const res = await createPOST(postRequest(validBody()));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ cafeId: "cafe-1", checkinId: "checkin-1" });
  });

  it("409s with the existing cafe id on duplicate external POI id", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // pre-check misses
      .mockRejectedValueOnce({ code: "23505" }); // insert hits the unique index
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: "existing-9" }] }); // post-rollback lookup
    const res = await createPOST(postRequest(validBody()));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "cafe_exists",
      cafe_id: "existing-9",
    });
  });

  it("429s after the per-user write budget is exhausted", async () => {
    for (let i = 0; i < 10; i += 1) {
      mockCreateHappyPath();
      const res = await createPOST(postRequest(validBody()));
      expect(res.status).toBe(201);
    }
    const eleventh = await createPOST(postRequest(validBody()));
    expect(eleventh.status).toBe(429);
  });
});

describe("GET /api/cafes", () => {
  it("400s without lat/lng, on a non-positive radius, and on out-of-range coordinates", async () => {
    expect((await listGET(new Request("https://localhost/api/cafes"))).status).toBe(400);
    expect(
      (await listGET(new Request("https://localhost/api/cafes?lat=1&lng=103&radius_km=0"))).status,
    ).toBe(400);
    expect((await listGET(new Request("https://localhost/api/cafes?lat=999&lng=103"))).status).toBe(
      400,
    );
    expect((await listGET(new Request("https://localhost/api/cafes?lat=1&lng=999"))).status).toBe(
      400,
    );
  });

  it("clamps radius to the 10 km cap and returns the list", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await listGET(
      new Request("https://localhost/api/cafes?lat=1.27&lng=103.84&radius_km=999"),
    );
    expect(res.status).toBe(200);
    expect(poolQueryMock.mock.calls[0][1][2]).toBe(10); // clamped
  });

  it("passes a fractional radius through to the query", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await listGET(
      new Request("https://localhost/api/cafes?lat=1.27&lng=103.84&radius_km=1.5"),
    );
    expect(res.status).toBe(200);
    expect(poolQueryMock.mock.calls[0][1][2]).toBe(1.5);
  });
});

describe("GET /api/cafes/[id]", () => {
  it("400s on a non-UUID id", async () => {
    const res = await detailGET(new Request("https://localhost/api/cafes/nope"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("404s when the cafe is missing, 200s with the detail row", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const missing = await detailGET(new Request("https://localhost/api/cafes/x"), {
      params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440001" }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: "not_found",
      message: "cafe not found",
    });

    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: "c1", name: "Caracara" }] });
    const found = await detailGET(new Request("https://localhost/api/cafes/x"), {
      params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440001" }),
    });
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toMatchObject({ name: "Caracara" });
  });
});
