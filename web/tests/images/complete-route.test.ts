import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/images/complete/route";

const queryMock = vi.fn();
const getUserMock = vi.fn();
const getProcessUrlsMock = vi.fn();
const processImageMock = vi.fn();

vi.mock("@/lib/db/postgres", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  withTransaction: async (fn: (client: { query: typeof queryMock }) => unknown) =>
    fn({ query: queryMock }),
}));
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: getUserMock } }),
  isAuthConfigured: () => true,
}));
vi.mock("@/lib/images/image-service-client", () => ({
  getProcessUrls: (...args: unknown[]) => getProcessUrlsMock(...args),
}));
vi.mock("@/lib/images/processor", () => ({
  processImage: (...args: unknown[]) => processImageMock(...args),
}));

// Valid UUIDs everywhere: the intent binding (issue #33) validates them.
const USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const CAFE_ID = "11111111-1111-4111-9111-111111111111";
const CHECKIN_ID = "22222222-2222-4222-a222-222222222222";
const IMAGE_UUID = "12345678-1234-4123-9234-123456789abc";

/** Queue the intent pre-check hit (issue #33) before ownership etc. */
function queueIntentHit() {
  return queryMock.mockResolvedValueOnce({ rows: [{ image_uuid: IMAGE_UUID }] });
}

describe("POST /api/images/complete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUserMock.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    getProcessUrlsMock.mockResolvedValue({
      imageUuid: IMAGE_UUID,
      original: { url: "get", headers: {} },
      originalPut: { url: "put", headers: {} },
      card: { url: "card", headers: {} },
      thumbnail: { url: "thumb", headers: {} },
      publicUrls: {
        original: "https://images.example.com/original/uuid.webp",
        card: "https://images.example.com/card/uuid.webp",
        thumbnail: "https://images.example.com/thumb/uuid.webp",
      },
      keys: {
        original: "original/uuid.webp",
        card: "card/uuid.webp",
        thumbnail: "thumb/uuid.webp",
      },
    });
    processImageMock.mockResolvedValue({
      imageUuid: IMAGE_UUID,
      publicUrls: {
        original: "https://images.example.com/original/uuid.webp",
        card: "https://images.example.com/card/uuid.webp",
        thumbnail: "https://images.example.com/thumb/uuid.webp",
      },
      width: 100,
      height: 80,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(body: unknown): Request {
    return new Request("https://localhost/api/images/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("completes a cafe image upload and returns public URLs", async () => {
    queueIntentHit();
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE_ID }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ image_uuid: IMAGE_UUID }] }) // intent consume
      .mockResolvedValueOnce({ rows: [{ id: CAFE_ID }] }); // update

    const response = await POST(makeRequest({
      imageUuid: IMAGE_UUID,
      targetType: "cafe",
      targetId: CAFE_ID,
      isCover: true,
    }));

    const data = await response.json();
    expect(data.publicUrls.card).toBe("https://images.example.com/card/uuid.webp");

    const [sql, params] = queryMock.mock.calls[3]; // [intent, ownership, consume, attach]
    expect(sql).toContain("created_by = $4");
    expect(params[3]).toBe(USER_ID);
  });

  it("rejects unauthenticated requests", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(makeRequest({ imageUuid: IMAGE_UUID, targetType: "cafe", targetId: CAFE_ID }));
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid request body", async () => {
    const response = await POST(makeRequest({ targetType: "cafe" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for a non-UUID targetId", async () => {
    const response = await POST(makeRequest({ imageUuid: IMAGE_UUID, targetType: "cafe", targetId: "not-a-uuid" }));
    expect(response.status).toBe(400);
  });

  it("404s when the upload was never issued to this user (#33), before any remote work", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // intent check finds nothing
    const response = await POST(makeRequest({
      imageUuid: IMAGE_UUID,
      targetType: "cafe",
      targetId: CAFE_ID,
    }));
    expect(response.status).toBe(404);
    expect(getProcessUrlsMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the target cafe is not owned by the user", async () => {
    queueIntentHit();
    queryMock.mockResolvedValueOnce({ rows: [] }); // ownership check fails
    const response = await POST(makeRequest({
      imageUuid: IMAGE_UUID,
      targetType: "cafe",
      targetId: CAFE_ID,
    }));
    expect(response.status).toBe(404);
    expect(getProcessUrlsMock).not.toHaveBeenCalled();
  });

  it("404s when the intent was already consumed or expired (replay)", async () => {
    queueIntentHit();
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE_ID }] }) // ownership check
      .mockResolvedValueOnce({ rows: [] }); // intent consume: 0 rows

    const response = await POST(makeRequest({
      imageUuid: IMAGE_UUID,
      targetType: "cafe",
      targetId: CAFE_ID,
    }));
    expect(response.status).toBe(404);
    // The attach must NOT have run.
    const allSql = queryMock.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allSql.some((sql) => sql.includes("update cafes"))).toBe(false);
  });

  it("completes a checkin image upload and auto-merges into the cafe gallery", async () => {
    queueIntentHit();
    queryMock
      .mockResolvedValueOnce({ rows: [{ cafe_id: CAFE_ID }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ image_uuid: IMAGE_UUID }] }) // intent consume
      .mockResolvedValueOnce({ rows: [{ id: CHECKIN_ID, cafe_id: CAFE_ID }] }) // checkin update
      .mockResolvedValueOnce({ rows: [] }); // cafe gallery auto-merge

    const response = await POST(makeRequest({
      imageUuid: IMAGE_UUID,
      targetType: "checkin",
      targetId: CHECKIN_ID,
    }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.width).toBe(100);

    const [, checkinParams] = queryMock.mock.calls[3]; // [intent, ownership, consume, attach]
    expect(checkinParams[2]).toBe(USER_ID); // user_id guard
  });

  it("does not leak raw upstream error bodies", async () => {
    queueIntentHit();
    queryMock.mockResolvedValueOnce({ rows: [{ id: CAFE_ID }] }); // ownership check
    getProcessUrlsMock.mockRejectedValueOnce(new Error("upstream leaked body {secret}"));

    const response = await POST(makeRequest({
      imageUuid: IMAGE_UUID,
      targetType: "cafe",
      targetId: CAFE_ID,
    }));

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toBe("image_processing_error");
    expect(data.message).toBeUndefined();
  });

  it("guards against duplicate gallery entries", async () => {
    queueIntentHit();
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: CAFE_ID }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ image_uuid: IMAGE_UUID }] }) // intent consume
      .mockResolvedValueOnce({ rows: [{ id: CAFE_ID }] }); // update

    const response = await POST(makeRequest({
      imageUuid: IMAGE_UUID,
      targetType: "cafe",
      targetId: CAFE_ID,
    }));

    expect(response.status).toBe(200);
    const [sql] = queryMock.mock.calls[3]; // [intent, ownership, consume, attach]
    expect(sql).toContain("@>");
  });
});
