import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createCheckIn, softDeleteCheckIn, toggleCheckInLike, updateCheckIn } from "@/lib/db/checkins";
import {
  CafeNotFoundError,
  CheckInNotFoundError,
  DuplicateCheckInError,
  SelfLikeError,
  parseCheckInBody,
  parseMaxStayFilter,
  parsePhotoIds,
  parseScores,
  parseVisitedAt,
  type CreateCheckInInput,
} from "@/lib/validation/checkin";
import { MAX_STAY_VALUES } from "@/types/checkins";
import { INVALID_CHECKIN_PAYLOADS } from "./helpers/fixtures";
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

vi.mock("@/lib/db/postgres", async (importOriginal) => ({
  // Real tx adapters: they are pure functions of the client, so the fake
  // client below exercises the same statement routing as production.
  ...(await importOriginal<typeof import("@/lib/db/postgres")>()),
  withTransaction: (fn: (client: { query: typeof clientQueryMock }) => unknown) =>
    fn({ query: clientQueryMock }),
  query: (...args: unknown[]) => poolQueryMock(...args),
}));

// Real provisionPhotos/consumeProvisionedIntents run against these fake deps;
// only the default-deps factory is swapped (issue #86 seam).
const provisionDeps: Record<string, Mock> = {
  checkUploadIntents: vi.fn(),
  consumeUploadIntents: vi.fn(),
  getProcessUrls: vi.fn(),
  processImage: vi.fn(),
  // Unreferenced by default: unit compensation deletes every id, and the
  // BRAWUKA-401 race test below overrides this to simulate a winner's row.
  selectPhotoReferences: vi.fn().mockResolvedValue([]),
  selectLiveUploadIntents: vi.fn().mockResolvedValue([]),
  deleteProvisionedVariants: vi.fn(),
};

vi.mock("@/lib/images/provision-photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/images/provision-photos")>()),
  defaultProvisionPhotosDeps: () => provisionDeps,
}));

const USER = { id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" };
const CAFE = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const CHECKIN = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";
const IDEMPOTENCY_KEY = "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";
const IMG = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";

const FAKE_KEYS = {
  original: `original/${IMG}.webp`,
  card: `card/${IMG}.webp`,
  thumbnail: `thumbnail/${IMG}.webp`,
};


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

/** Mock the happy-path createCheckIn statements + stats recompute via query dispatcher. */
function mockCheckInHappyPath(checkinId = CHECKIN) {
  const handler = async (sql: string) => {
    const s = sql.toLowerCase();
    if (s.includes("select work_stats from cafes") || s.includes("for update")) {
      return { rows: [{ id: CAFE, work_stats: {} }], rowCount: 1 };
    }
    if (s.includes("from cafes where id = $1") || s.includes("select id from cafes")) {
      return { rows: [{ id: CAFE }], rowCount: 1 };
    }
    if (s.includes("visited_at > now()")) {
      return { rows: [], rowCount: 0 }; // no live check-in inside the revisit window
    }
    if (s.includes("insert into checkins")) {
      return { rows: [{ id: checkinId }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  poolQueryMock.mockImplementation(handler);
  clientQueryMock.mockImplementation(handler);
}

beforeEach(() => {
  vi.resetAllMocks();
  signedIn();
  provisionDeps.checkUploadIntents.mockResolvedValue([IMG]);
  provisionDeps.consumeUploadIntents.mockResolvedValue(true);
  provisionDeps.getProcessUrls.mockResolvedValue({ keys: FAKE_KEYS });
  provisionDeps.processImage.mockResolvedValue({ imageUuid: IMG, width: 800, height: 600 });
});

describe("parseScores", () => {
  it("rejects non-object, null, and array inputs", () => {
    expect(parseScores(null).ok).toBe(false);
    expect(parseScores("invalid").ok).toBe(false);
    expect(parseScores([]).ok).toBe(false);
    expect(parseScores(123).ok).toBe(false);
  });

  it("rejects unknown dimensions", () => {
    const res = parseScores({ vibe: 50 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("scores.vibe is not a known dimension");
  });

  it("rejects non-number, NaN, Infinity, and out-of-range scores", () => {
    expect(parseScores({ wifi: "80" }).ok).toBe(false);
    expect(parseScores({ wifi: NaN }).ok).toBe(false);
    expect(parseScores({ wifi: Infinity }).ok).toBe(false);
    expect(parseScores({ wifi: -1 }).ok).toBe(false);
    expect(parseScores({ wifi: 101 }).ok).toBe(false);
  });

  it("accepts valid score ranges and all known work dimensions", () => {
    const valid = parseScores({
      wifi: 0,
      outlets: 50,
      seats: 100,
      temp: 80,
      coffee: 90,
      overall: 75,
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.wifi).toBe(0);
      expect(valid.value.seats).toBe(100);
      expect(valid.value.overall).toBe(75);
    }
  });

  it("prefixes error messages with a custom field name", () => {
    const res = parseScores({ bad: 10 }, "custom.scores");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("custom.scores.bad");
  });
});

describe("parsePhotoIds", () => {
  it("rejects non-array inputs", () => {
    expect(parsePhotoIds("not-an-array").ok).toBe(false);
    expect(parsePhotoIds(null).ok).toBe(false);
    expect(parsePhotoIds({}).ok).toBe(false);
  });

  it("rejects array exceeding the maximum photos cap (cap is 6)", () => {
    const seven = Array.from(
      { length: 7 },
      (_, i) => `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a5${i.toString(16)}`,
    );
    const res = parsePhotoIds(seven);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("limited to 6 photos");
  });

  it("rejects invalid UUID entries and non-string entries", () => {
    expect(parsePhotoIds(["not-a-uuid"]).ok).toBe(false);
    expect(parsePhotoIds([123]).ok).toBe(false);
    expect(parsePhotoIds([null]).ok).toBe(false);
    expect(parsePhotoIds([{}]).ok).toBe(false);
  });

  it("rejects duplicate photo UUIDs including case variations", () => {
    expect(parsePhotoIds([IMG, IMG]).ok).toBe(false);
    expect(parsePhotoIds([IMG, IMG.toUpperCase()]).ok).toBe(false);
  });
  it("accepts exactly 6 distinct photo UUIDs (cap boundary, DG68)", () => {
    const six = Array.from(
      { length: 6 },
      (_, i) => `a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a4${i.toString(16)}`,
    );
    const res = parsePhotoIds(six);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toHaveLength(6);
    }
  });

  it("accepts valid photo UUID arrays and normalizes to lowercase", () => {
    const upper = IMG.toUpperCase();
    const res = parsePhotoIds([upper]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toEqual([IMG.toLowerCase()]);
    }
  });
  it("prefixes error messages with a custom field name", () => {
    const res = parsePhotoIds(["bad"], "custom.photos");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("custom.photos");
  });
});

describe("parseVisitedAt", () => {
  it("returns undefined for null or undefined", () => {
    expect(parseVisitedAt(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseVisitedAt(null)).toEqual({ ok: true, value: undefined });
  });

  it("rejects non-string inputs", () => {
    expect(parseVisitedAt(123456789).ok).toBe(false);
    expect(parseVisitedAt({}).ok).toBe(false);
  });

  it("rejects unparseable timestamps", () => {
    const res = parseVisitedAt("last-tuesday");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("must be an ISO 8601 timestamp");
  });

  it("rejects non-ISO date strings that Date would parse (BRAWUKA-449)", () => {
    for (const input of [
      "March 5, 2020",
      "03/05/2020",
      "2020-03-05",
      "2020-03-05 10:00:00Z",
      "2020-03-05T10:00:00",
      "2020-03-05T10:00Z",
      "2020-03-05T10:00:00+0800x",
      "2020-03-05T24:00:00Z",
      "2020-02-30T00:00:00Z",
      "2021-02-29T00:00:00Z",
      "2020-13-01T00:00:00Z",
    ]) {
      expect(parseVisitedAt(input).ok, input).toBe(false);
    }
  });

  it("accepts ISO offsets and fractional seconds", () => {
    for (const input of [
      "2020-03-05T10:00:00+08:00",
      "2020-03-05T10:00:00+0800",
      "2020-03-05T10:00:00.123456Z",
      "2020-03-05T10:00:00.1+08:00",
    ]) {
      expect(parseVisitedAt(input).ok, input).toBe(true);
    }
  });

  it("rejects future timestamps", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const res = parseVisitedAt(future);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("cannot be in the future");
  });

  it("accepts valid past/present ISO timestamp strings and returns Date objects", () => {
    const iso = "2026-08-01T00:00:00.000Z";
    const res = parseVisitedAt(iso);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toBeInstanceOf(Date);
      expect(res.value?.toISOString()).toBe(iso);
    }
  });

  it("prefixes error messages with a custom field name", () => {
    const res = parseVisitedAt("bad", "custom.visited_at");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("custom.visited_at");
  });
});

describe("parseMaxStayFilter", () => {
  it("returns undefined when the filter is absent or empty", () => {
    expect(parseMaxStayFilter(null)).toBeUndefined();
    expect(parseMaxStayFilter("")).toBeUndefined();
  });

  it("accepts every domain label in MAX_STAY_VALUES", () => {
    for (const label of MAX_STAY_VALUES) {
      expect(parseMaxStayFilter(label)).toBe(label);
    }
  });

  it("ignores unknown labels instead of rejecting them", () => {
    expect(parseMaxStayFilter("invalid_stay_label")).toBeUndefined();
    expect(parseMaxStayFilter("3H")).toBeUndefined();
    expect(parseMaxStayFilter(" 3h")).toBeUndefined();
  });
});

describe("parseCheckInBody", () => {
  it("accepts a minimal valid body (cafe_id + one score)", () => {
    expect(parseCheckInBody({ cafe_id: CAFE, scores: { wifi: 80 } }).ok).toBe(true);
  });

  it("accepts a full valid body with all optional fields", () => {
    const parsed = parseCheckInBody({
      cafe_id: CAFE,
      scores: { wifi: 80, coffee: 90 },
      max_stay: "unlimited",
      note: "quiet work corner",
      photo_ids: [IMG],
      visited_at: "2026-08-01T00:00:00.000Z",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.cafe_id).toBe(CAFE);
      expect(parsed.value.max_stay).toBe("unlimited");
      expect(parsed.value.note).toBe("quiet work corner");
      expect(parsed.value.photo_ids).toEqual([IMG]);
      expect(parsed.value.visited_at).toBeInstanceOf(Date);
    }
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

  it("rejects a non-ISO visited_at that Date would parse (BRAWUKA-449)", () => {
    expect(parseCheckInBody(validBody({ visited_at: "March 5, 2020" })).ok).toBe(false);
  });

  it("accepts all valid max_stay enum values", () => {
    const values = ["unlimited", "3h", "2h", "1h", "peak", "unknown"] as const;
    for (const val of values) {
      expect(parseCheckInBody(validBody({ max_stay: val })).ok).toBe(true);
    }
  });

  it("treats an empty photo_ids array and blank note as absent", () => {
    const parsed = parseCheckInBody({ cafe_id: CAFE, scores: { wifi: 1 }, photo_ids: [], note: "  " });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.photo_ids).toBeUndefined();
      expect(parsed.value.note).toBeUndefined();
    }
  });
  it("accepts a valid idempotency_key and normalizes it to lowercase (DG61)", () => {
    const parsed = parseCheckInBody(
      validBody({ idempotency_key: "B1EEBC99-9C0B-4EF8-BB6D-6BB9BD380A55" }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.idempotency_key).toBe("b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a55");
    }
  });

  it("rejects a non-UUID idempotency_key but treats null as absent (DG61)", () => {
    expect(parseCheckInBody(validBody({ idempotency_key: "not-a-uuid" })).ok).toBe(false);
    expect(parseCheckInBody(validBody({ idempotency_key: 42 })).ok).toBe(false);
    const absent = parseCheckInBody(validBody({ idempotency_key: null }));
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.value.idempotency_key).toBeUndefined();
  });
});

describe("createCheckIn", () => {
  it("skips provisioning, photo writes, and the gallery merge when the check-in has no photos", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ lock: 1 }] }) // BRAWUKA-125 advisory xact lock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // in-tx cafe gate
      .mockResolvedValueOnce({ rows: [] }) // revisit window: no live check-in
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] }) // insert
      .mockResolvedValueOnce({ rows: [] }) // DG79 navigation auto-resolve
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await createCheckIn(USER.id, validInput({ photo_ids: undefined }));
    expect(clientQueryMock).toHaveBeenCalledTimes(8);
    expect(provisionDeps.checkUploadIntents).not.toHaveBeenCalled();
    expect(provisionDeps.consumeUploadIntents).not.toHaveBeenCalled();
    for (const call of clientQueryMock.mock.calls) {
      expect(call[0]).not.toContain("gallery");
      expect(call[0]).not.toContain("set photos");
    }
  });

  it("fails before the transaction when a photo id has no valid intent (foreign/replayed)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    provisionDeps.checkUploadIntents.mockResolvedValue([]);

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoIntentError);
    expect(provisionDeps.getProcessUrls).not.toHaveBeenCalled(); // no remote work
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("attaches live originals post-commit with the real check-in id (BRAWUKA-400)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    mockCheckInHappyPath(CHECKIN);

    const result = await createCheckIn(USER.id, validInput());

    expect(result).toEqual({ checkin_id: CHECKIN, deduped: false });
    // Provision leg (pre-target) + post-commit attach leg (final target).
    const calls = provisionDeps.getProcessUrls.mock.calls.map((call) => call[0]);
    expect(calls.filter((req) => req.targetType === "provision")).toHaveLength(1);
    const attach = calls.filter((req) => req.targetType === "checkin");
    expect(attach).toHaveLength(1);
    expect(attach[0]).toMatchObject({ imageUuid: IMG, targetType: "checkin", targetId: CHECKIN });
  });

  it("skips the attach re-mark on a raced idempotency dedupe (BRAWUKA-400)", async () => {
    const key = IDEMPOTENCY_KEY;
    poolQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("idempotency_key")) return { rows: [], rowCount: 0 }; // fast-path miss
      return { rows: [{ id: CAFE }], rowCount: 1 }; // pre-provision cafe gate
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      const s = sql.toLowerCase();
      if (s.includes("insert into checkins")) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
      if (s.includes("idempotency_key")) return { rows: [{ id: CHECKIN }], rowCount: 1 };
      if (s.includes("select id from cafes")) return { rows: [{ id: CAFE }], rowCount: 1 };
      if (s.includes("visited_at > now()")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const result = await createCheckIn(USER.id, validInput({ idempotency_key: key }));

    expect(result).toEqual({ checkin_id: CHECKIN, deduped: true });
    const calls = provisionDeps.getProcessUrls.mock.calls.map((call) => call[0]);
    expect(calls.filter((req) => req.targetType === "provision")).toHaveLength(1);
    expect(calls.filter((req) => req.targetType === "checkin")).toHaveLength(0);
  });

  it("skips intent consume and photo writes on a raced idempotency dedupe with photos (BRAWUKA-565)", async () => {
    const key = IDEMPOTENCY_KEY;
    poolQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("idempotency_key")) return { rows: [], rowCount: 0 }; // fast-path miss
      return { rows: [{ id: CAFE }], rowCount: 1 }; // pre-provision cafe gate
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      const s = sql.toLowerCase();
      if (s.includes("insert into checkins")) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
      if (s.includes("idempotency_key")) return { rows: [{ id: CHECKIN }], rowCount: 1 }; // winner's id
      if (s.includes("select id from cafes")) return { rows: [{ id: CAFE }], rowCount: 1 };
      if (s.includes("visited_at > now()")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    // The winner already consumed the single-use intents: a consume attempt
    // here would abort the loser's tx (pre-fix 400 on same photo_ids).
    provisionDeps.consumeUploadIntents.mockResolvedValue(false);

    const result = await createCheckIn(USER.id, validInput({ idempotency_key: key }));

    expect(result).toEqual({ checkin_id: CHECKIN, deduped: true });
    expect(provisionDeps.consumeUploadIntents).not.toHaveBeenCalled();
    for (const call of clientQueryMock.mock.calls) {
      const sql = call[0] as string;
      expect(sql).not.toContain("set photos");
      expect(sql.toLowerCase()).not.toContain("gallery");
    }
  });



  it("rejects a second create inside the revisit window without inserting (DG64)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ lock: 1 }] }) // BRAWUKA-125 advisory xact lock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // in-tx cafe gate
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] }); // window hit: live check-in

    const err = await createCheckIn(USER.id, validInput({ photo_ids: undefined })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DuplicateCheckInError);
    expect((err as DuplicateCheckInError).existingCheckinId).toBe(CHECKIN);
    // Lock + gate + window check, no insert.
    expect(clientQueryMock).toHaveBeenCalledTimes(3);
    for (const call of clientQueryMock.mock.calls) {
      expect(call[0]).not.toContain("insert into checkins");
    }
  });

  it("keeps the winner's R2 objects when a loser rolls back on the revisit window (BRAWUKA-401)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    provisionDeps.selectPhotoReferences.mockResolvedValueOnce([IMG]); // winner committed
    const deleted: string[] = [];
    provisionDeps.deleteProvisionedVariants.mockImplementation(async (id: string) => {
      deleted.push(id);
    });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ lock: 1 }] }) // BRAWUKA-125 advisory xact lock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // in-tx cafe gate
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] }); // window hit: live check-in

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DuplicateCheckInError);
    expect(provisionDeps.selectPhotoReferences).toHaveBeenCalledWith([IMG]);
    expect(deleted).toEqual([]); // referenced: the loser's rollback deletes nothing
  });

  it("keeps a concurrent winner's R2 objects when its commit is still in flight (BRAWUKA-502)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    // The winner has not committed yet: independent failure (DuplicateCheckInError
    // on cafe B) with a live intent for the shared photo id. The loser's
    // rollback deletes nothing; the #158 sweeper is the backstop.
    provisionDeps.selectLiveUploadIntents.mockResolvedValueOnce([IMG]);
    const deleted: string[] = [];
    provisionDeps.deleteProvisionedVariants.mockImplementation(async (id: string) => {
      deleted.push(id);
    });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ lock: 1 }] }) // BRAWUKA-125 advisory xact lock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // in-tx cafe gate
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] }); // window hit: live check-in

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DuplicateCheckInError);
    expect(provisionDeps.selectLiveUploadIntents).toHaveBeenCalledWith(USER.id, [IMG]);
    expect(deleted).toEqual([]);
  });

  it("throws CafeNotFoundError without provisioning or inserting when the cafe is missing", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision cafe check

    const err = await createCheckIn(USER.id, validInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CafeNotFoundError);
    expect(provisionDeps.checkUploadIntents).not.toHaveBeenCalled(); // no wasted sharp work
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("rejects invalid ids before touching the database", async () => {
    await expect(createCheckIn("not-a-uuid", validInput())).rejects.toThrow("Invalid user ID");
    await expect(createCheckIn(USER.id, validInput({ cafe_id: "nope" }))).rejects.toThrow(
      "Invalid cafe ID",
    );
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
    expect(provisionDeps.checkUploadIntents).not.toHaveBeenCalled();
  });

  it("rejects an invalid idempotency key before touching the database (DG61)", async () => {
    await expect(
      createCheckIn(USER.id, validInput({ idempotency_key: "not-a-uuid" })),
    ).rejects.toThrow("Invalid idempotency key");
    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
    expect(provisionDeps.checkUploadIntents).not.toHaveBeenCalled();
  });

  it("returns the original id without writing when the key was already recorded (DG61 replay)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CHECKIN }] }); // fast-path hit

    const result = await createCheckIn(
      USER.id,
      validInput({ photo_ids: undefined, idempotency_key: IDEMPOTENCY_KEY }),
    );
    expect(result).toEqual({ checkin_id: CHECKIN, deduped: true });
    // The replay short-circuits before provisioning and the transaction:
    // single-use intents stay untouched, no second row, no stats rewrite.
    expect(poolQueryMock).toHaveBeenCalledTimes(1);
    expect(clientQueryMock).not.toHaveBeenCalled();
    expect(provisionDeps.checkUploadIntents).not.toHaveBeenCalled();
  });

  it("converts a raced insert conflict into the winner's id instead of a second row (DG61)", async () => {
    poolQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("idempotency_key")) return { rows: [], rowCount: 0 }; // fast-path miss
      return { rows: [{ id: CAFE }], rowCount: 1 }; // pre-provision cafe gate
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      const s = sql.toLowerCase();
      if (s.includes("insert into checkins")) return { rows: [], rowCount: 0 }; // ON CONFLICT DO NOTHING
      if (s.includes("idempotency_key")) return { rows: [{ id: CHECKIN }], rowCount: 1 };
      if (s.includes("select id from cafes")) return { rows: [{ id: CAFE }], rowCount: 1 };
      if (s.includes("visited_at > now()")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const result = await createCheckIn(
      USER.id,
      validInput({ photo_ids: undefined, idempotency_key: IDEMPOTENCY_KEY }),
    );
    expect(result).toEqual({ checkin_id: CHECKIN, deduped: true });
    const insert = clientQueryMock.mock.calls.find((call) =>
      (call[0] as string).toLowerCase().includes("insert into checkins"),
    )!;
    expect(insert[1]).toEqual([
      CAFE,
      USER.id,
      JSON.stringify({ wifi: 80 }),
      "unlimited",
      "quiet",
      JSON.stringify([]),
      null,
      IDEMPOTENCY_KEY,
    ]);
  });
});

describe("check-in edit/delete lock order (BRAWUKA-574)", () => {
  const checkinRow = {
    id: CHECKIN,
    cafe_id: CAFE,
    user_id: USER.id,
    deleted_at: null,
  };

  beforeEach(() => {
    clientQueryMock.mockReset();
    clientQueryMock.mockImplementation(async (sql: string) => {
      const s = sql.toLowerCase();
      if (s.includes("select cafe_id from checkins")) {
        return { rows: [{ cafe_id: CAFE }], rowCount: 1 };
      }
      if (s.includes("from cafes") && s.includes("for update")) {
        return { rows: [{ "?column?": 1 }], rowCount: 1 };
      }
      if (s.includes("from checkins where id")) {
        return { rows: [checkinRow], rowCount: 1 };
      }
      // recomputeWorkStats runs on the same fake client here; its cafe
      // lock + checkin scan + stats write need no real rows for an
      // order assertion (real-DB behavior is covered by integration).
      if (s.includes("for update")) {
        return { rows: [{ id: CAFE }], rowCount: 1 };
      }
      if (s.includes("from checkins")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it("updateCheckIn locks the cafe row before the check-in row", async () => {
    await updateCheckIn(USER.id, CHECKIN, { note: "revisited" });
    const statements = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    const cafeLockIdx = statements.findIndex(
      (s) => s.includes("from cafes") && s.includes("for update"),
    );
    const checkinLockIdx = statements.findIndex(
      (s) => s.includes("from checkins where id") && s.includes("for update"),
    );
    expect(cafeLockIdx).toBeGreaterThan(-1);
    expect(checkinLockIdx).toBeGreaterThan(-1);
    expect(cafeLockIdx).toBeLessThan(checkinLockIdx);
  });

  it("softDeleteCheckIn locks the cafe row before the check-in row", async () => {
    const result = await softDeleteCheckIn(USER.id, CHECKIN);
    expect(result).toEqual({ cafeId: CAFE });
    const statements = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    const cafeLockIdx = statements.findIndex(
      (s) => s.includes("from cafes") && s.includes("for update"),
    );
    const checkinLockIdx = statements.findIndex(
      (s) => s.includes("from checkins where id") && s.includes("for update"),
    );
    expect(cafeLockIdx).toBeGreaterThan(-1);
    expect(checkinLockIdx).toBeGreaterThan(-1);
    expect(cafeLockIdx).toBeLessThan(checkinLockIdx);
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

    expect(result).toEqual({ liked: false, likes_count: 2 });
  });

  it("sends the viewer-scoped cafe visibility gate inside the toggle CTE (BRAWUKA-634)", async () => {
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [{ checkin_count: 1, inserted_count: 1, deleted_count: 0, is_author: false }],
      })
      .mockResolvedValueOnce({ rows: [{ likes_count: 1 }] });

    const result = await toggleCheckInLike(USER.id, CHECKIN);

    expect(result).toEqual({ liked: true, likes_count: 1 });
    expect(clientQueryMock).toHaveBeenCalledTimes(2);
    const [sql, params] = clientQueryMock.mock.calls[0];
    expect(sql).toContain("cafes.visibility = 'public'");
    expect(sql).toContain("cafes.created_by = $1");
    expect(sql).toContain("cafes.deleted_at IS NULL");
    expect(params).toEqual([USER.id, CHECKIN]);
  });

  it("throws CheckInNotFoundError when the check-in does not exist or is soft-deleted", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ checkin_count: 0, inserted_count: 0, deleted_count: 0, is_author: null }],
    });

    const err = await toggleCheckInLike(USER.id, CHECKIN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckInNotFoundError);
    expect((err as Error).message).toMatch(/Check-in not found or deleted/);
  });

  it("404s on the route for a private-cafe check-in the caller cannot see (BRAWUKA-634)", async () => {
    // Same empty row as a missing check-in: the viewer-scoped cafe EXISTS
    // gate filtered the CTE, so the toggle 404s instead of leaking existence.
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ checkin_count: 0, inserted_count: 0, deleted_count: 0, is_author: null }],
    });

    const res = await likePOST(new Request(`https://localhost/api/checkins/${CHECKIN}/like`, {
      method: "POST",
    }), { params: Promise.resolve({ id: CHECKIN }) });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "not_found" });
  });
});

describe("POST /api/checkins", () => {
  const url = "https://localhost/api/checkins";

  it("400s with invalid_request error envelope on invalid payloads", async () => {
    getUserMock.mockClear();
    const invalidBodies = [
      INVALID_CHECKIN_PAYLOADS.empty,
      INVALID_CHECKIN_PAYLOADS.nonUuidCafeId,
    ];

    for (const body of invalidBodies) {
      const res = await checkinPOST(postRequest(url, body));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: "invalid_request",
        message: expect.any(String),
      });
    }
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

  it("422s invalid_photos when a photo id was not issued to the caller", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] });
    provisionDeps.checkUploadIntents.mockResolvedValue([]);
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_photos" });
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("422s invalid_photos when the caller's upload never landed in R2 (worker 404)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] });
    provisionDeps.getProcessUrls.mockRejectedValue(
      new ImageServiceError("Image not found", 404, 404),
    );
    const res = await checkinPOST(postRequest(url, validBody()));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_photos" });
    expect(clientQueryMock).not.toHaveBeenCalled();
  });


  it("409s duplicate_checkin with the existing id when inside the revisit window (DG64)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: CAFE }] }); // pre-provision cafe check
    clientQueryMock
      .mockResolvedValueOnce({ rows: [{ lock: 1 }] }) // BRAWUKA-125 advisory xact lock
      .mockResolvedValueOnce({ rows: [{ id: CAFE }] }) // in-tx cafe gate
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN }] }); // window hit
    const res = await checkinPOST(postRequest(url, validBody({ photo_ids: undefined })));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "duplicate_checkin",
      existing_checkin_id: CHECKIN,
    });
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


  it("403s self_like_forbidden when the caller is the check-in author", async () => {
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ checkin_count: 1, inserted_count: 0, deleted_count: 0, is_author: true }],
    });
    const res = await likePOST(...likeRequest(CHECKIN));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "self_like_forbidden" });
  });
});
