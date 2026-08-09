import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/images/upload/route";
import { MAX_UPLOAD_BYTES } from "@/lib/images/constants";

const getUserMock = vi.fn();
const requestUploadUrlMock = vi.fn();

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: getUserMock } }),
  isAuthConfigured: () => true,
}));
vi.mock("@/lib/images/image-service-client", () => ({
  ImageServiceError: class ImageServiceError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  requestUploadUrl: (...args: unknown[]) => requestUploadUrlMock(...args),
}));

function makeRequest(body: unknown): Request {
  return new Request("https://localhost/api/images/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/images/upload", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    requestUploadUrlMock.mockResolvedValue({ imageUuid: "uuid", uploadUrl: "u" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects when the session is missing", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest({ size: 1024 }));
    expect(res.status).toBe(401);
  });

  it("requires size (review 2026-08-09: omitted size used to produce an uncapped PUT)", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
    expect(requestUploadUrlMock).not.toHaveBeenCalled();
  });

  it("rejects size above MAX_UPLOAD_BYTES", async () => {
    const res = await POST(makeRequest({ size: MAX_UPLOAD_BYTES + 1 }));
    expect(res.status).toBe(400);
    expect(requestUploadUrlMock).not.toHaveBeenCalled();
  });

  it("forwards a valid size to the image service", async () => {
    const res = await POST(makeRequest({ size: 2048 }));
    expect(res.status).toBe(200);
    expect(requestUploadUrlMock).toHaveBeenCalledWith(2048);
  });
});
