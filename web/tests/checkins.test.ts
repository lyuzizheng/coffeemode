import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CafeNotFoundError,
  CheckInNotFoundError,
  createCheckIn,
  parseCheckInBody,
  toggleCheckInLike,
  type CreateCheckInInput,
} from "@/lib/db/checkins";
import { POST as checkinPOST } from "@/app/api/checkins/route";
import { POST as likePOST } from "@/app/api/checkins/[id]/like/route";

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
const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";

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

function validInput(overrides: Partial<CreateCheckInInput> = {}): CreateCheckInInput {
  return {
    cafe_id: CAFE,
    scores: { wifi: 80 },
    min_spend: "drink",
    max_stay: "unlimited",
    note: "quiet",
    photos: [SAMPLE_IMG],
    ...overrides,
  };
}

/** Route-level body (JSON shape). */
function validBody(overrides: Record<string, unknown> = {}) {
  return { ...validInput(), ...overrides };
}

function signedIn() {
  getUserMock.mockResolvedValue({ data: { user: USER }, error: null });
}

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Mock the happy-path createCheckIn statements + stats recompute (6 queries, with photos). */
function mockCheckInHappyPath(checkinId = CHECKIN) {
  clientQueryMock
    .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // cafe exists
    .mockResolvedValueOnce({ rows: [{ id: checkinId }] }) // insert check-in
    .mockResolvedValueOnce({ rows: [] }) // gallery auto-merge (spec 0001)
    .mockResolvedValueOnce({ rows: [] }) // stats recompute: lock cafe row
    .mockResolvedValueOnce({ rows: [] }) // stats recompute: read all check-ins
    .mockResolvedValueOnce({ rows: [] }); // stats recompute: write work_stats
}

beforeEach(() => {
  vi.resetAllMocks();
  signedIn();
});

describe("parseCheckInBody", () => {
  it("accepts a minimal valid body (cafe_id + one score)", () => {
    expect(parseCheckInBody({ cafe_id: CAFE, scores: { wifi: 80 } }).ok).toBe(true);
  });

  it("rejects a non-object body and a missing/invalid cafe_id", () => {
    expect(parseCheckInBody(null).ok).toBe(false);
    expect(parseCheckInBody({}).ok).toBe(false);
    expect(parseCheckInBody({ cafe_id: "nope", scores: { wifi: 1 } }).ok).toBe(false);
  });

  it("requires at least one slider (spec 0001) — policies/note/photos alone do not count", () => {
    expect(parseCheckInBody({ cafe_id: CAFE }).ok).toBe(false);
    expect(parseCheckInBody({ cafe_id: CAFE, scores: {} }).ok).toBe(false);
    expect(parseCheckInBody({ cafe_id: CAFE, note: "  ", photos: [] }).ok).toBe(false);
    expect(parseCheckInBody({ cafe_id: CAFE, min_spend: "none" }).ok).toBe(false);
    expect(parseCheckInBody({ cafe_id: CAFE, note: "great", photos: [SAMPLE_IMG] }).ok).toBe(false);
    // ...but any single slider is enough, extras optional.
    expect(parseCheckInBody({ cafe_id: CAFE, scores: { overall: 70 } }).ok).toBe(true);
  });

  it("rejects bad policy enums, scores, photos, and a future visited_at", () => {
    expect(parseCheckInBody(validBody({ min_spend: "free" })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ max_stay: "forever" })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ scores: { wifi: 101 } })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ scores: { vibe: 50 } })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ photos: [{}] })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ note: "x".repeat(1001) })).ok).toBe(false);
    expect(
      parseCheckInBody(validBody({ visited_at: new Date(Date.now() + 60_000).toISOString() })).ok,
    ).toBe(false);
  });

  it("treats an empty photos array and blank note as absent", () => {
    const parsed = parseCheckInBody({ cafe_id: CAFE, scores: { wifi: 1 }, photos: [], note: "  " });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.photos).toBeUndefined();
      expect(parsed.value.note).toBeUndefined();
    }
  });
});

describe("createCheckIn", () => {
  it("inserts the check-in, merges photos into the gallery, and recomputes stats — one transaction", async () => {
    mockCheckInHappyPath();
    const result = await createCheckIn(USER.id, validInput());
    expect(result).toEqual({ checkinId: CHECKIN });

    const insert = clientQueryMock.mock.calls[1];
    expect(insert[0]).toContain("insert into checkins");
    expect(insert[0]).toContain("false"); // never a creation check-in
    expect(insert[1]).toEqual([
      CAFE,
      USER.id,
      JSON.stringify({ wifi: 80 }),
      "drink",
      "unlimited",
      "quiet",
      JSON.stringify([SAMPLE_IMG]),
      null,
    ]);

    // Photos auto-merge into cafes.gallery with check-in provenance (spec 0001).
    const gallery = clientQueryMock.mock.calls[2];
    expect(gallery[0]).toContain("update cafes");
    expect(gallery[0]).toContain("gallery");
    expect(gallery[1][0]).toBe(CAFE);
    expect(JSON.parse(gallery[1][1] as string)).toEqual([
      { ...SAMPLE_IMG, source: { type: "checkin", id: CHECKIN } },
    ]);

    // Stats refresh is a full recompute on the SAME connection (backdated
    // visited_at would corrupt the incremental fold — see lib comment).
    const statsLock = clientQueryMock.mock.calls[3];
    expect(statsLock[0]).toContain("for update");
    expect(statsLock[1]).toEqual([CAFE]);
    expect(clientQueryMock.mock.calls[4][0]).toContain("from checkins");
  });

  it("skips the gallery merge when the check-in has no photos", async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] })
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await createCheckIn(USER.id, validInput({ photos: undefined }));

    expect(clientQueryMock).toHaveBeenCalledTimes(5);
    for (const call of clientQueryMock.mock.calls) {
      expect(call[0]).not.toContain("gallery");
    }
  });

  it("throws CafeNotFoundError without inserting when the cafe is missing", async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] }); // cafe exists check

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CafeNotFoundError);
    expect(clientQueryMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid ids before touching the database", async () => {
    await expect(createCheckIn("not-a-uuid", validInput())).rejects.toThrow("Invalid user ID");
    await expect(createCheckIn(USER.id, validInput({ cafe_id: "nope" }))).rejects.toThrow(
      "Invalid cafe ID",
    );
    expect(clientQueryMock).not.toHaveBeenCalled();
  });
});

describe("toggleCheckInLike", () => {
  it("throws for an invalid user id", async () => {
    await expect(toggleCheckInLike("not-a-uuid", CHECKIN)).rejects.toThrow(
      /Invalid user or check-in ID/,
    );
  });

  it("throws for an invalid check-in id", async () => {
    await expect(toggleCheckInLike(USER.id, "not-a-uuid")).rejects.toThrow(
      /Invalid user or check-in ID/,
    );
  });

  it("returns liked=true with the updated count when a like is inserted", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ likes_count: 7, deleted_count: 0, inserted_count: 1 }],
    });

    const result = await toggleCheckInLike(USER.id, CHECKIN);

    expect(result).toEqual({ liked: true, likesCount: 7 });
    expect(clientQueryMock).toHaveBeenCalledOnce();
    const [sql, params] = clientQueryMock.mock.calls[0];
    expect(sql).toContain("DELETE FROM checkin_likes");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).toContain("FOR UPDATE");
    expect(params).toEqual([USER.id, CHECKIN]);
  });

  it("returns liked=false with the updated count when a like is removed", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ likes_count: 4, deleted_count: 1, inserted_count: 0 }],
    });

    const result = await toggleCheckInLike(USER.id, CHECKIN);

    expect(result).toEqual({ liked: false, likesCount: 4 });
  });

  it("throws CheckInNotFoundError when the check-in does not exist or is soft-deleted", async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const err = await toggleCheckInLike(USER.id, CHECKIN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckInNotFoundError);
    expect((err as Error).message).toMatch(/Check-in not found or deleted/);
  });
});

describe("POST /api/checkins", () => {
  const url = "https://localhost/api/checkins";

  it("400s on an invalid body before checking auth", async () => {
    getUserMock.mockClear();
    const res = await checkinPOST(postRequest(url, {}));
    expect(res.status).toBe(400);
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("401s without a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(401);
  });

  it("404s when the cafe does not exist", async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] }); // cafe exists check
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("201s with the new check-in id", async () => {
    mockCheckInHappyPath();
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ checkinId: CHECKIN });
  });

  it("429s after the per-user write budget is exhausted", async () => {
    for (let i = 0; i < 10; i += 1) {
      mockCheckInHappyPath();
      const res = await checkinPOST(postRequest(url, validBody()));
      expect(res.status).toBe(201);
    }
    const eleventh = await checkinPOST(postRequest(url, validBody()));
    expect(eleventh.status).toBe(429);
  });
});

describe("POST /api/checkins/[id]/like", () => {
  function likeRequest(id: string) {
    return [
      new Request(`https://localhost/api/checkins/${id}/like`, { method: "POST" }),
      { params: Promise.resolve({ id }) },
    ] as const;
  }

  it("400s on a non-UUID id", async () => {
    const res = await likePOST(...likeRequest("nope"));
    expect(res.status).toBe(400);
  });

  it("401s without a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await likePOST(...likeRequest(CHECKIN));
    expect(res.status).toBe(401);
  });

  it("404s when the check-in is missing or soft-deleted", async () => {
    clientQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await likePOST(...likeRequest(CHECKIN));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("200s with the toggle result", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ likes_count: 7, deleted_count: 0, inserted_count: 1 }],
    });
    const res = await likePOST(...likeRequest(CHECKIN));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ liked: true, likesCount: 7 });
  });
});
