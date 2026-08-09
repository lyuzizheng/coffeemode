import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { getProcessUrls, requestUploadUrl } from "@/lib/images/image-service-client";

describe("image-service-client", () => {
  let fetchSpy: Mock;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("IMAGE_SERVICE_URL", "https://image-service.example.com");
    vi.stubEnv("IMAGE_SERVICE_TOKEN", "test-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requestUploadUrl returns the worker response", async () => {
    const response = {
      imageUuid: "uuid",
      uploadUrl: "https://r2.example.com/upload",
      uploadHeaders: { "Content-Type": "image/webp" },
      publicUrl: "https://images.example.com/original/uuid.webp",
      expiresAt: new Date().toISOString(),
      maxUploadBytes: 10 * 1024 * 1024,
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await requestUploadUrl();
    expect(result).toEqual(response);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://image-service.example.com/v1/images/upload");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.["x-image-service-token"]).toBe("test-token");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.body).toBeUndefined();
  });

  it("requestUploadUrl forwards the file size when provided", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          imageUuid: "uuid",
          uploadUrl: "https://r2.example.com/upload",
          uploadHeaders: { "Content-Type": "image/webp" },
          publicUrl: "https://images.example.com/original/uuid.webp",
          expiresAt: new Date().toISOString(),
          maxUploadBytes: 10 * 1024 * 1024,
          size: 1024,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await requestUploadUrl(1024);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.size).toBe(1024);
  });

  it("getProcessUrls posts the completion request", async () => {
    const response = {
      imageUuid: "uuid",
      original: { url: "get-url", headers: {} },
      originalPut: { url: "put-url", headers: { "Content-Type": "image/webp" } },
      card: { url: "card-url", headers: { "Content-Type": "image/webp" } },
      thumbnail: { url: "thumb-url", headers: { "Content-Type": "image/webp" } },
      publicUrls: { original: "a", card: "b", thumbnail: "c" },
      keys: { original: "o", card: "c", thumbnail: "t" },
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getProcessUrls({
      imageUuid: "uuid",
      targetType: "cafe",
      targetId: "cafe-id",
      userId: "user-id",
    });
    expect(result).toEqual(response);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.imageUuid).toBe("uuid");
    expect(body.targetType).toBe("cafe");
    expect(body.targetId).toBe("cafe-id");
    expect(body.userId).toBe("user-id");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws a sanitized error on non-2xx responses (no upstream body leak)", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 502 }));
    await expect(requestUploadUrl()).rejects.toMatchObject({
      name: "ImageServiceError",
      message: "Image service unavailable",
      status: 502,
      upstreamStatus: 502,
    });
  });

  it("maps an upstream 401 (bad service token) to 502, not a user-facing 401", async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    await expect(getProcessUrls({ imageUuid: "u", targetType: "cafe", targetId: "t" })).rejects.toMatchObject({
      message: "Image service unavailable",
      status: 502,
      upstreamStatus: 401,
    });
  });

  it("maps an upstream 404 to 'Image not found' with status 404", async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":"missing"}', { status: 404 }));
    await expect(getProcessUrls({ imageUuid: "u", targetType: "cafe", targetId: "t" })).rejects.toMatchObject({
      message: "Image not found",
      status: 404,
    });
  });
});
