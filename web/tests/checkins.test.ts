import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CafeNotFoundError,
  CheckInNotFoundError,
  SelfLikeError,
  createCheckIn,
  parseCheckInBody,
  toggleCheckInLike,
  type CreateCheckInInput,
} from "@/lib/db/checkins";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import { ImageServiceError } from "@/lib/images/image-service-client";
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

// Real provisionPhotos/consumeProvisionedIntents run against these fake deps;
// only the default-deps factory is swapped (issue #86 seam).
const provisionDeps = {
  checkUploadIntent: vi.fn(),
  consumeUploadIntent: vi.fn(),
  getProcessUrls: vi.fn(),
  processImage: vi.fn(),
};

vi.mock("@/lib/images/provision-photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/images/provision-photos")>()),
  defaultProvisionPhotosDeps: () => provisionDeps,
}));

const USER = { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" };
const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";
const IMG = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";

const FAKE_KEYS = {
  original: `original/${IMG}.webp`,
  card: `card/${IMG}.webp`,
  thumbnail: `thumbnail/${IMG}.webp`,
};

/** What the server must derive for IMG from the fake processing deps. */
function derivedPhoto(checkinId: string) {
  return {
    id: IMG,
    ...FAKE_KEYS,
    w: 800,
    h: 600,
    by: USER.id,
    at: expect.any(String),
    source: { type: "checkin", id: checkinId },
  };
}

function validInput(overrides: Partial<CreateCheckInInput> = {}): CreateCheckInInput {
  return {
    cafe_id: CAFE,
    scores: { wifi: 80 },
    max_stay: "unlimited",
    note: "quiet",
    photo_ids: [IMG],
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

/** Mock the happy-path createCheckIn statements + stats recompute (pool cafe check + 7 tx queries, with photos). */
function mockCheckInHappyPath(checkinId = CHECKIN) {
  poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
  clientQueryMock
    .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // cafe exists (authoritative, in tx)
    .mockResolvedValueOnce({ rows: [{ id: checkinId }] }) // insert check-in
    .mockResolvedValueOnce({ rows: [] }) // set derived photos (source needs the id)
    .mockResolvedValueOnce({ rows: [] }) // gallery auto-merge (spec 0001)
    .mockResolvedValueOnce({ rows: [] }) // stats recompute: lock cafe row
    .mockResolvedValueOnce({ rows: [] }) // stats recompute: read all check-ins
    .mockResolvedValueOnce({ rows: [] }); // stats recompute: write work_stats
}

beforeEach(() => {
  vi.resetAllMocks();
  signedIn();
  provisionDeps.checkUploadIntent.mockResolvedValue(true);
  provisionDeps.consumeUploadIntent.mockResolvedValue(true);
  provisionDeps.getProcessUrls.mockResolvedValue({ keys: FAKE_KEYS });
  provisionDeps.processImage.mockResolvedValue({ imageUuid: IMG, width: 800, height: 600 });
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
    expect(parseCheckInBody({ cafe_id: CAFE, note: "  ", photo_ids: [] }).ok).toBe(false);
    expect(parseCheckInBody({ cafe_id: CAFE, max_stay: "unlimited" }).ok).toBe(false);
    expect(parseCheckInBody({ cafe_id: CAFE, note: "great", photo_ids: [IMG] }).ok).toBe(false);
    // ...but any single slider is enough, extras optional.
    expect(parseCheckInBody({ cafe_id: CAFE, scores: { overall: 70 } }).ok).toBe(true);
  });

  it("rejects bad policy enums, scores, photo_ids, and a future visited_at", () => {
    expect(parseCheckInBody(validBody({ max_stay: "free" })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ max_stay: "forever" })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ scores: { wifi: 101 } })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ scores: { vibe: 50 } })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ photo_ids: ["not-a-uuid"] })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ photo_ids: [{}] })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ photo_ids: [IMG, IMG] })).ok).toBe(false); // duplicates
    expect(parseCheckInBody(validBody({ photo_ids: [IMG, IMG.toUpperCase()] })).ok).toBe(false); // case-insensitive dupes
    expect(
      parseCheckInBody(
        validBody({
          photo_ids: Array.from(
            { length: 7 },
            (_, i) => `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a5${i.toString(16)}`,
          ),
        }),
      ).ok,
    ).toBe(false); // cap is 6 (DG68)
    expect(parseCheckInBody(validBody({ note: "x".repeat(501) })).ok).toBe(false);
    expect(
      parseCheckInBody(validBody({ visited_at: new Date(Date.now() + 60_000).toISOString() })).ok,
    ).toBe(false);
  });

  it("accepts exactly 6 distinct photo ids (cap boundary, DG68)", () => {
    const six = Array.from(
      { length: 6 },
      (_, i) => `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a4${i.toString(16)}`,
    );
    expect(parseCheckInBody(validBody({ photo_ids: six })).ok).toBe(true);
  });

  it("treats an empty photo_ids array and blank note as absent", () => {
    const parsed = parseCheckInBody({ cafe_id: CAFE, scores: { wifi: 1 }, photo_ids: [], note: "  " });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.photo_ids).toBeUndefined();
      expect(parsed.value.note).toBeUndefined();
    }
  });
});

describe("createCheckIn", () => {
  it("provisions photos, inserts the check-in, derives StoredImage server-side, merges the gallery, and recomputes stats — one transaction", async () => {
    mockCheckInHappyPath();
    const result = await createCheckIn(USER.id, validInput());
    expect(result).toEqual({ checkinId: CHECKIN });

    // Intent pre-check and sharp processing ran BEFORE the transaction (no
    // DB connection held during remote work).
    expect(provisionDeps.checkUploadIntent).toHaveBeenCalledWith(USER.id, IMG);
    expect(provisionDeps.processImage).toHaveBeenCalledWith(IMG, { keys: FAKE_KEYS });

    const insert = clientQueryMock.mock.calls[1];
    expect(insert[0]).toContain("insert into checkins");
    expect(insert[0]).toContain("false"); // never a creation check-in
    expect(insert[1]).toEqual([
      CAFE,
      USER.id,
      JSON.stringify({ wifi: 80 }),
      "unlimited",
      "quiet",
      JSON.stringify([]), // photos land after insert — source needs the id
      null,
    ]);

    // The single-use intent consume ran INSIDE the transaction.
    expect(provisionDeps.consumeUploadIntent).toHaveBeenCalledWith(
      USER.id,
      IMG,
      expect.any(Function),
    );

    // Server-derived StoredImage: keys/w/h/by are NOT client-controlled.
    const setPhotos = clientQueryMock.mock.calls[2];
    expect(setPhotos[0]).toContain("update checkins set photos");
    // $1 = checkin id, $2 = photos JSON — matches `set photos = $2::jsonb where id = $1`.
    expect(setPhotos[1][0]).toBe(CHECKIN);
    expect(JSON.parse(setPhotos[1][1] as string)).toEqual([derivedPhoto(CHECKIN)]);

    // Photos auto-merge into cafes.gallery with check-in provenance (spec 0001).
    const gallery = clientQueryMock.mock.calls[3];
    expect(gallery[0]).toContain("update cafes");
    expect(gallery[0]).toContain("gallery");
    expect(gallery[1][0]).toBe(CAFE);
    expect(JSON.parse(gallery[1][1] as string)).toEqual([derivedPhoto(CHECKIN)]);

    // Stats refresh is a full recompute on the SAME connection (backdated
    // visited_at would corrupt the incremental fold — see lib comment).
    const statsLock = clientQueryMock.mock.calls[4];
    expect(statsLock[0]).toContain("for update");
    expect(statsLock[1]).toEqual([CAFE]);
    expect(clientQueryMock.mock.calls[5][0]).toContain("from checkins");
  });

  it("skips provisioning, photo writes, and the gallery merge when the check-in has no photos", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] })
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await createCheckIn(USER.id, validInput({ photo_ids: undefined }));

    expect(provisionDeps.checkUploadIntent).not.toHaveBeenCalled();
    expect(provisionDeps.consumeUploadIntent).not.toHaveBeenCalled();
    expect(clientQueryMock).toHaveBeenCalledTimes(5);
    for (const call of clientQueryMock.mock.calls) {
      expect(call[0]).not.toContain("gallery");
      expect(call[0]).not.toContain("set photos");
    }
  });

  it("fails before the transaction when a photo id has no valid intent (foreign/replayed)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    provisionDeps.checkUploadIntent.mockResolvedValue(false);

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoIntentError);
    expect(provisionDeps.getProcessUrls).not.toHaveBeenCalled(); // no remote work
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("aborts the check-in when the intent consume loses a replay race inside the tx", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    provisionDeps.consumeUploadIntent.mockResolvedValue(false);
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] })
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] });

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoIntentError);
    // Nothing past the insert: no photo write, no gallery merge, no stats.
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
  });

  it("throws CafeNotFoundError without provisioning or inserting when the cafe is missing", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision cafe check

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CafeNotFoundError);
    expect(provisionDeps.checkUploadIntent).not.toHaveBeenCalled(); // no wasted sharp work
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("rejects invalid ids before touching the database", async () => {
    await expect(createCheckIn("not-a-uuid", validInput())).rejects.toThrow("Invalid user ID");
    await expect(createCheckIn(USER.id, validInput({ cafe_id: "nope" }))).rejects.toThrow(
      "Invalid cafe ID",
    );
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
    expect(provisionDeps.checkUploadIntent).not.toHaveBeenCalled();
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
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{ checkin_count: 1, inserted_count: 1, deleted_count: 0, is_author: false }],
      })
      .mockResolvedValueOnce({ rows: [{ likes_count: 7 }] });

    const result = await toggleCheckInLike(USER.id, CHECKIN);

    expect(result).toEqual({ liked: true, likesCount: 7 });
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    const [toggleSql, toggleParams] = clientQueryMock.mock.calls[0];
    expect(toggleSql).toContain("DELETE FROM checkin_likes");
    expect(toggleSql).toContain("deleted_at IS NULL");
    expect(toggleSql).toContain("FOR UPDATE");
    expect(toggleSql).toContain("checkin_id IN (SELECT id FROM checkin)");
    // issue #107: the inserted CTE gates on caller <> check-in author.
    expect(toggleSql).toContain("user_id FROM checkin");
    expect(toggleSql).toContain("<> $1");
    expect(toggleParams).toEqual([USER.id, CHECKIN]);
    const [countSql, countParams] = clientQueryMock.mock.calls[1];
    expect(countSql).toContain("SELECT likes_count");
    expect(countParams).toEqual([CHECKIN]);
  });

  it("returns liked=false with the updated count when a like is removed", async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{ checkin_count: 1, inserted_count: 0, deleted_count: 1, is_author: false }],
      })
      .mockResolvedValueOnce({ rows: [{ likes_count: 4 }] });

    const result = await toggleCheckInLike(USER.id, CHECKIN);

    expect(result).toEqual({ liked: false, likesCount: 4 });
  });

  it("throws SelfLikeError when the caller likes their own check-in (issue #107)", async () => {
    // A blocked like attempt: nothing deleted, nothing inserted, and the
    // locked checkin CTE reports the caller as the author.
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ checkin_count: 1, inserted_count: 0, deleted_count: 0, is_author: true }],
    });

    const err = await toggleCheckInLike(USER.id, CHECKIN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SelfLikeError);
    expect((err as Error).message).toMatch(/cannot like your own check-in/);
  });

  it("allows un-liking a legacy self-like row written before the rule", async () => {
    // Un-like of a pre-existing self-like: the row is deleted, no re-insert.
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{ checkin_count: 1, inserted_count: 0, deleted_count: 1, is_author: true }],
      })
      .mockResolvedValueOnce({ rows: [{ likes_count: 2 }] });

    const result = await toggleCheckInLike(USER.id, CHECKIN);

    expect(result).toEqual({ liked: false, likesCount: 2 });
  });

  it("throws CheckInNotFoundError when the check-in does not exist or is soft-deleted", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ checkin_count: 0, inserted_count: 0, deleted_count: 0, is_author: null }],
    });

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
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision cafe check
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("400s invalid_photos when a photo id was not issued to the caller", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] });
    provisionDeps.checkUploadIntent.mockResolvedValue(false);
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_photos" });
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("400s invalid_photos when the caller's upload never landed in R2 (worker 404)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] });
    provisionDeps.getProcessUrls.mockRejectedValue(
      new ImageServiceError("Image not found", 404, 404),
    );
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_photos" });
    expect(clientQueryMock).not.toHaveBeenCalled();
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
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ checkin_count: 0, inserted_count: 0, deleted_count: 0, is_author: null }],
    });
    const res = await likePOST(...likeRequest(CHECKIN));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("200s with the toggle result", async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{ checkin_count: 1, inserted_count: 1, deleted_count: 0, is_author: false }],
      })
      .mockResolvedValueOnce({ rows: [{ likes_count: 7 }] });
    const res = await likePOST(...likeRequest(CHECKIN));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ liked: true, likesCount: 7 });
  });

  it("403s self_like_forbidden when the caller is the check-in author", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ checkin_count: 1, inserted_count: 0, deleted_count: 0, is_author: true }],
    });
    const res = await likePOST(...likeRequest(CHECKIN));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "self_like_forbidden" });
  });
});
