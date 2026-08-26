import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CafeExistsError,
  createCafeWithFirstCheckIn,
  getCafe,
  listCafesNearby,
  parseCreateCafeBody,
  reviveCafe,
  type CreateCafeCheckInInput,
} from "@/lib/db/cafes";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import { ImageServiceError } from "@/lib/images/image-service-client";
import { GET as listGET, POST as createPOST } from "@/app/api/cafes/route";
import { DELETE as detailDELETE, GET as detailGET } from "@/app/api/cafes/[id]/route";

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

const USER = { id: "550e8400-e29b-41d4-a716-446655440000" };
// Singapore — tz-lookup resolves these to Asia/Singapore (pure, no I/O).
const SG = { lat: 1.2789, lng: 103.8425 };
const IMG = "550e8400-e29b-41d4-a716-446655440099";

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

/** The spec-0001 minimum for the creator's first check-in. */
const VALID_CHECKIN = {
  scores: { wifi: 80, overall: 75 },
  max_stay: "unlimited",
  note: "quiet",
  photo_ids: [IMG],
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
    max_stay: "unlimited",
    note: "quiet",
    photo_ids: [IMG],
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

/** Mock the statements of the happy-path create transaction + stats (pool dedupe check + 9 tx queries). */
function mockCreateHappyPath(cafeId = "cafe-1", checkinId = "checkin-1") {
  poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision dedupe check
  clientQueryMock
    .mockResolvedValueOnce({ rows: [] }) // dedupe pre-check by external id (authoritative, in tx)
    .mockResolvedValueOnce({ rows: [{ id: cafeId }] }) // insert cafe
    .mockResolvedValueOnce({ rows: [{ id: checkinId }] }) // insert first check-in
    .mockResolvedValueOnce({ rows: [] }) // set derived photos (source needs the id)
    .mockResolvedValueOnce({ rows: [] }) // gallery auto-merge (spec 0001)
    .mockResolvedValueOnce({ rows: [{ work_stats: {} }] }) // stats: lock + read cafe
    .mockResolvedValueOnce({ rows: [] }) // stats: user's check-ins (none in mock)
    .mockResolvedValueOnce({ rows: [{ n: 1 }] }) // stats: check-in count
    .mockResolvedValueOnce({ rows: [] }); // stats: update cafes.work_stats
}

beforeEach(() => {
  vi.resetAllMocks();
  signedIn();
  provisionDeps.checkUploadIntent.mockResolvedValue(true);
  provisionDeps.consumeUploadIntent.mockResolvedValue(true);
  provisionDeps.getProcessUrls.mockResolvedValue({ keys: FAKE_KEYS });
  provisionDeps.processImage.mockResolvedValue({ imageUuid: IMG, width: 800, height: 600 });
});

describe("parseCreateCafeBody", () => {
  it("accepts a minimal valid body", () => {
    const parsed = parseCreateCafeBody({ name: "Kiosk", ...SG, checkin: VALID_CHECKIN });
    expect(parsed.ok).toBe(true);
  });

  it("preserves opaque provider ids without truncating them", () => {
    const applePoiId = `apple:${"x".repeat(700)}`;
    const parsed = parseCreateCafeBody({
      name: "Kiosk",
      ...SG,
      apple_poi_id: applePoiId,
      checkin: VALID_CHECKIN,
    });
    expect(parsed).toEqual(expect.objectContaining({ ok: true, value: expect.objectContaining({ apple_poi_id: applePoiId }) }));
  });

  it("rejects provider ids beyond the 1024-char bound", () => {
    const parsed = parseCreateCafeBody({
      name: "Kiosk",
      ...SG,
      apple_poi_id: `apple:${"x".repeat(2000)}`,
      checkin: VALID_CHECKIN,
    });
    expect(parsed.ok).toBe(false);
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

  it("requires overall, max_stay, note, and >=1 photo on creation (spec 0001)", () => {
    expect(parseCreateCafeBody(validBody({ scores: { wifi: 80 } })).ok).toBe(false); // no overall
    expect(parseCreateCafeBody(validBody({ max_stay: undefined })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ note: undefined })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ note: "" })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photo_ids: undefined })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photo_ids: [] })).ok).toBe(false);
  });

  it("rejects malformed photo ids", () => {
    expect(parseCreateCafeBody(validBody({ photo_ids: ["not-a-uuid"] })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photo_ids: [{}] })).ok).toBe(false);
    expect(parseCreateCafeBody(validBody({ photo_ids: [IMG, IMG] })).ok).toBe(false); // duplicates
  });

  it("rejects invalid policy enums and malformed opening_hours", () => {
    expect(parseCreateCafeBody(validBody({ max_stay: "free" })).ok).toBe(false);
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
  it("provisions photos, inserts cafe + first check-in, derives StoredImage server-side, merges the gallery, and folds stats — one transaction", async () => {
    mockCreateHappyPath();
    const result = await createCafeWithFirstCheckIn(USER.id, {
      name: "Caracara",
      ...SG,
      google_place_id: "ChIJx",
      checkin: validCheckinInput(),
    });

    expect(result).toEqual({ cafeId: "cafe-1", checkinId: "checkin-1", tz: "Asia/Singapore" });

    // Intent pre-check and sharp processing ran BEFORE the transaction.
    expect(provisionDeps.checkUploadIntent).toHaveBeenCalledWith(USER.id, IMG);
    expect(provisionDeps.processImage).toHaveBeenCalledWith(IMG, { keys: FAKE_KEYS });

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
    // Required first-check-in fields land after scores (max_stay, note, photos).
    expect(checkinInsert[1][3]).toBe("unlimited");
    expect(checkinInsert[1][4]).toBe("quiet");
    expect(checkinInsert[1][5]).toBe(JSON.stringify([])); // photos land after insert

    // The single-use intent consume ran INSIDE the transaction.
    expect(provisionDeps.consumeUploadIntent).toHaveBeenCalledWith(
      USER.id,
      IMG,
      expect.any(Function),
    );

    // Server-derived StoredImage: keys/w/h/by are NOT client-controlled.
    const setPhotos = clientQueryMock.mock.calls[3];
    expect(setPhotos[0]).toContain("update checkins set photos");
    // $1 = checkin id, $2 = photos JSON — matches `set photos = $2::jsonb where id = $1`.
    expect(setPhotos[1][0]).toBe("checkin-1");
    expect(JSON.parse(setPhotos[1][1] as string)).toEqual([derivedPhoto("checkin-1")]);

    // First check-in's photos auto-merge into cafes.gallery with provenance.
    const galleryMerge = clientQueryMock.mock.calls[4];
    expect(galleryMerge[0]).toContain("update cafes");
    expect(galleryMerge[0]).toContain("gallery");
    expect(galleryMerge[1][0]).toBe("cafe-1");
    expect(JSON.parse(galleryMerge[1][1] as string)).toEqual([derivedPhoto("checkin-1")]);

    // Stats fold ran on the SAME connection (no second transaction).
    const statsCall = clientQueryMock.mock.calls[5];
    expect(statsCall[0]).toContain("for update");
    expect(statsCall[1]).toEqual(["cafe-1"]);
  });

  it("fails before any DB write or remote work when a photo id has no valid intent (foreign/replayed)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision dedupe check
    provisionDeps.checkUploadIntent.mockResolvedValue(false);

    const err = await createCafeWithFirstCheckIn(USER.id, {
      name: "x",
      ...SG,
      google_place_id: "ChIJx",
      checkin: validCheckinInput(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoIntentError);
    expect(provisionDeps.getProcessUrls).not.toHaveBeenCalled(); // no remote work
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("aborts the creation when the intent consume loses a replay race inside the tx", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision dedupe check
    provisionDeps.consumeUploadIntent.mockResolvedValue(false);
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // dedupe pre-check
      .mockResolvedValueOnce({ rows: [{ id: "cafe-1" }] }) // insert cafe
      .mockResolvedValueOnce({ rows: [{ id: "checkin-1" }] }); // insert first check-in

    const err = await createCafeWithFirstCheckIn(USER.id, {
      name: "x",
      ...SG,
      google_place_id: "ChIJx",
      checkin: validCheckinInput(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PhotoIntentError);
    // Nothing past the inserts: no photo write, no gallery merge, no stats.
    expect(clientQueryMock).toHaveBeenCalledTimes(3);
  });

  it("dedupes on the pool pre-check without provisioning or opening a transaction", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ id: "existing-7" }] }); // pre-provision dedupe hit

    const err = await createCafeWithFirstCheckIn(USER.id, {
      name: "Dupe",
      ...SG,
      google_place_id: "ChIJx",
      checkin: validCheckinInput(),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CafeExistsError);
    expect((err as CafeExistsError).existingCafeId).toBe("existing-7");
    expect(provisionDeps.checkUploadIntent).not.toHaveBeenCalled(); // no wasted sharp work
    expect(clientQueryMock).not.toHaveBeenCalled(); // no transaction attempted
  });

  it("maps a lost unique-index race to CafeExistsError via a post-rollback lookup", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision dedupe misses (race window)
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // in-tx pre-check misses too
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
    expect(poolQueryMock).toHaveBeenCalledTimes(2); // pre-provision check + post-rollback lookup
  });

  it("rejects an invalid user id before touching the database", async () => {
    await expect(
      createCafeWithFirstCheckIn("not-a-uuid", {
        name: "x",
        ...SG,
        checkin: validCheckinInput(),
      }),
    ).rejects.toThrow("Invalid user ID");
    expect(poolQueryMock).not.toHaveBeenCalled();
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

  it("400s invalid_photos when a photo id was not issued to the caller", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision dedupe check
    provisionDeps.checkUploadIntent.mockResolvedValue(false);
    const res = await createPOST(postRequest(validBody()));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_photos" });
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("400s invalid_photos when the caller's upload never landed in R2 (worker 404)", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision dedupe check
    provisionDeps.getProcessUrls.mockRejectedValue(
      new ImageServiceError("Image not found", 404, 404),
    );
    const res = await createPOST(postRequest(validBody()));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_photos" });
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("409s with the existing cafe id on duplicate external POI id", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] }); // pre-provision dedupe misses
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // in-tx pre-check misses
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

  it("strips StoredImage.by from gallery (DG13 anonymous surface, #197)", async () => {
    const gallery = [
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        original: "original/a.webp",
        card: "card/a.webp",
        thumbnail: "thumbnail/a.webp",
        w: 800,
        h: 600,
        by: "550e8400-e29b-41d4-a716-446655440000",
        at: "2026-08-01T00:00:00.000Z",
        source: { type: "checkin", id: "c1" },
      },
    ];
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ id: "c1", name: "Caracara", gallery, work_stats: {} }],
    });
    const res = await detailGET(new Request("https://localhost/api/cafes/x"), {
      params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440001" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { gallery: Array<Record<string, unknown>> };
    expect(body.gallery).toHaveLength(1);
    expect(body.gallery[0]).not.toHaveProperty("by");
    expect(body.gallery[0]).toMatchObject({
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      card: "card/a.webp",
    });
  });
});

describe("toPublicCafeDetail", () => {
  it("strips by from every gallery entry while preserving other fields", async () => {
    const { toPublicCafeDetail } = await import("@/lib/db/cafes");
    const cafe = {
      id: "c1",
      slug: null,
      name: "Test",
      lat: 1.35,
      lng: 103.8,
      address: null,
      city: null,
      tz: null,
      opening_hours: null,
      price_range: null,
      work_stats: {
        n_users: 0,
        n_checkins: 0,
        dims: {} as never,
        policies: { max_stay: {} },
        experience_score: null,
        composite_score: null,
        updated_at: new Date().toISOString(),
      },
      cover: null,
      description: null,
      gallery: [
        {
          id: "img1",
          original: "original/img1.webp",
          card: "card/img1.webp",
          thumbnail: "thumbnail/img1.webp",
          w: 800,
          h: 600,
          by: "user-1",
          at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "img2",
          original: "original/img2.webp",
          card: "card/img2.webp",
          thumbnail: "thumbnail/img2.webp",
          w: 400,
          h: 300,
          by: "user-2",
          at: "2026-08-02T00:00:00.000Z",
        },
      ],
      google_place_id: null,
      apple_poi_id: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    } as unknown as import("@/types/cafes").CafeDetail;
    const pub = toPublicCafeDetail(cafe);
    expect(pub.gallery).toHaveLength(2);
    for (const img of pub.gallery) {
      expect(img).not.toHaveProperty("by");
    }
    expect((cafe.gallery[0] as unknown as Record<string, unknown>).by).toBe("user-1");
  });
});

describe("reviveCafe", () => {
  it("rejects non-uuid id and executes revive query", async () => {
    await expect(reviveCafe("invalid-uuid")).resolves.toBe(false);
    expect(poolQueryMock).not.toHaveBeenCalled();

    poolQueryMock.mockResolvedValueOnce({ rowCount: 1 });
    const ok = await reviveCafe("550e8400-e29b-41d4-a716-446655440001");
    expect(ok).toBe(true);
    expect(poolQueryMock.mock.calls[0][0]).toContain("update cafes set deleted_at = null");
    expect(poolQueryMock.mock.calls[0][1]).toEqual(["550e8400-e29b-41d4-a716-446655440001"]);
  });
});

describe("DELETE /api/cafes/[id]", () => {
  it("400s on a non-UUID id", async () => {
    const res = await detailDELETE(new Request("https://localhost/api/cafes/nope", { method: "DELETE" }), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("401s when unauthenticated", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await detailDELETE(
      new Request("https://localhost/api/cafes/550e8400-e29b-41d4-a716-446655440001", { method: "DELETE" }),
      { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440001" }) },
    );
    expect(res.status).toBe(401);
  });

  it("404s when the cafe does not exist", async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });
    const res = await detailDELETE(
      new Request("https://localhost/api/cafes/550e8400-e29b-41d4-a716-446655440001", { method: "DELETE" }),
      { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440001" }) },
    );
    expect(res.status).toBe(404);
  });

  it("403s when user is not creator", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "550e8400-e29b-41d4-a716-446655440001" }] }) // cafeExists
      .mockResolvedValueOnce({ rowCount: 0 }); // softDeleteCafe (user mismatch)
    const res = await detailDELETE(
      new Request("https://localhost/api/cafes/550e8400-e29b-41d4-a716-446655440001", { method: "DELETE" }),
      { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440001" }) },
    );
    expect(res.status).toBe(403);
  });

  it("200s and soft-deletes when creator deletes the cafe", async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "550e8400-e29b-41d4-a716-446655440001" }] }) // cafeExists
      .mockResolvedValueOnce({ rowCount: 1 }); // softDeleteCafe
    const res = await detailDELETE(
      new Request("https://localhost/api/cafes/550e8400-e29b-41d4-a716-446655440001", { method: "DELETE" }),
      { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440001" }) },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: "550e8400-e29b-41d4-a716-446655440001" });
  });
});
