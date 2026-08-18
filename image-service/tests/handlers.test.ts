import { afterEach, describe, expect, it, vi } from "vitest";
import { headObject } from "../src/r2";
import handler, { handleComplete, handleUpload } from "../src/index";
import { MAX_UPLOAD_BYTES } from "../src/constants";
import { baseEnv } from "./helpers";

// Same value as tests/helpers.ts baseEnv() service token (derived so there
// is exactly one literal).
const { IMAGE_SERVICE_TOKEN: TOKEN } = baseEnv();

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  const url = `https://image-service.example.com${path}`;
  const init: RequestInit = {
    method,
    headers: {
      "x-image-service-token": TOKEN,
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  return new Request(url, init);
}

function validUuid(): string {
  // Variant 9 (RFC4122) and version 4-ish, accepted by our UUID regex.
  return "12345678-1234-4123-9234-123456789abc";
}

describe("handleUpload", () => {
  it("returns presigned PUT URL for the original key", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", { size: 2048 });
    const response = await handleUpload(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.imageUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.uploadUrl).toContain(`original/${data.imageUuid}.webp`);
    expect(data.uploadUrl).toContain("X-Amz-Expires=");
    expect(data.publicUrl).toBe(`https://images.coffeemode.app/original/${data.imageUuid}.webp`);
    expect(data.uploadHeaders["Content-Type"]).toBe("image/webp");
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("uses UPLOAD_URL_TTL_SECONDS for expiresAt and the presigned URL", async () => {
    const env = { ...baseEnv(), UPLOAD_URL_TTL_SECONDS: "120" };
    const request = makeRequest("POST", "/v1/images/upload", { size: 1 });
    const response = await handleUpload(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.uploadUrl).toContain("X-Amz-Expires=120");
    const ttlMs = new Date(data.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(110_000);
    expect(ttlMs).toBeLessThanOrEqual(120_000);
  });

  it("falls back to the default 600s TTL on a garbage UPLOAD_URL_TTL_SECONDS", async () => {
    const env = { ...baseEnv(), UPLOAD_URL_TTL_SECONDS: "not-a-number" };
    const request = makeRequest("POST", "/v1/images/upload", { size: 1 });
    const response = await handleUpload(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.uploadUrl).toContain("X-Amz-Expires=600");
  });

  it("includes the max upload size in the response", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", { size: 1 });
    const response = await handleUpload(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.maxUploadBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it("rejects uploads larger than the 10 MB cap with a 400 envelope", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", {
      size: MAX_UPLOAD_BYTES + 1,
    });
    const response = await handleUpload(request, env);

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string; message: string };
    expect(data.error).toBe("size_exceeded");
    // Unified message shared with the web route via web/shared (issue #26).
    expect(data.message).toContain(`at most ${MAX_UPLOAD_BYTES} bytes`);
  });

  it("signs Content-Length when size is provided", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", { size: 1024 });
    const response = await handleUpload(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.size).toBe(1024);
    expect(data.uploadHeaders["Content-Length"]).toBe("1024");
  });

  it("rejects an invalid size type", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", { size: "big" });
    const response = await handleUpload(request, env);

    expect(response.status).toBe(400);
  });

  it("rejects size 0", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", { size: 0 });
    const response = await handleUpload(request, env);
    expect(response.status).toBe(400);
  });

  it("rejects a missing size (required since 2026-08-09 — uncapped PUT otherwise)", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", {});
    const response = await handleUpload(request, env);
    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: string; message: string };
    expect(data.error).toBe("invalid_request");
    expect(data.message).toContain("size");
  });

  it("rejects malformed JSON with a 400 envelope (same as /complete)", async () => {
    const env = baseEnv();
    const request = new Request("https://image-service.example.com/v1/images/upload", {
      method: "POST",
      headers: { "x-image-service-token": TOKEN, "Content-Type": "application/json" },
      body: "{not json",
    });
    const response = await handleUpload(request, env);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_request");
  });

  it("rejects requests without a token", async () => {
    const env = baseEnv();
    const request = new Request("https://image-service.example.com/v1/images/upload", {
      method: "POST",
    });
    const response = await handleUpload(request, env);
    expect(response.status).toBe(401);
  });

  it("rejects a correct-length wrong-value token", async () => {
    const env = baseEnv();
    // Same length as the real token, wrong value — exercises the
    // equal-length constant-time compare path.
    const wrongValue = TOKEN.split("").reverse().join("");
    const request = makeRequest("POST", "/v1/images/upload", { size: 1 }, {
      "x-image-service-token": wrongValue,
    });
    const response = await handleUpload(request, env);
    expect(response.status).toBe(401);
  });

  it("accepts Authorization bearer headers (case-insensitive scheme)", async () => {
    const env = baseEnv();
    for (const scheme of ["Bearer", "bearer"]) {
      const request = new Request("https://image-service.example.com/v1/images/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: [scheme, TOKEN].join(" "),
        },
        body: JSON.stringify({ size: 1 }),
      });
      const response = await handleUpload(request, env);
      expect(response.status).toBe(200);
    }
  });
});

describe("handleComplete", () => {
  it("returns presigned URLs after verifying the original exists", async () => {
    const env = baseEnv();
    const imageUuid = validUuid();

    await env.R2_BUCKET.put(`original/${imageUuid}.webp`, new Uint8Array([0xde, 0xad, 0xbe, 0xef]), {
      httpMetadata: { contentType: "image/webp" },
    });

    const request = makeRequest("POST", "/v1/images/complete", {
      imageUuid,
      userId: "u1",
      targetType: "cafe",
      targetId: "c1",
    });

    const response = await handleComplete(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.imageUuid).toBe(imageUuid);
    expect(data.original.url).toContain(`original/${imageUuid}.webp`);
    expect(data.originalPut.url).toContain(`original/${imageUuid}.webp`);
    expect(data.card.url).toContain(`card/${imageUuid}.webp`);
    expect(data.thumbnail.url).toContain(`thumbnail/${imageUuid}.webp`);
    expect(data.publicUrls.original).toBe(`https://images.coffeemode.app/original/${imageUuid}.webp`);

    // Metadata is baked into the signed PUT URLs so the Next.js processor
    // uploads it back to R2 without needing R2 credentials.
    expect(data.originalPut.headers["x-amz-meta-userid"]).toBe("u1");
    expect(data.originalPut.headers["x-amz-meta-targettype"]).toBe("cafe");
    expect(data.originalPut.headers["x-amz-meta-targetid"]).toBe("c1");
    expect(data.originalPut.headers["Content-Type"]).toBe("image/webp");
  });

  it("returns 404 when original does not exist", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/complete", { imageUuid: validUuid() });
    const response = await handleComplete(request, env);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBe("not_found");
  });

  it("rejects invalid UUIDs", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/complete", { imageUuid: "not-a-uuid" });
    const response = await handleComplete(request, env);
    expect(response.status).toBe(400);
  });

  it("422s when the actual R2 object exceeds the size cap", async () => {
    const env = baseEnv();
    const imageUuid = validUuid();
    // FakeR2 records body length as the object size — simulate an oversized
    // upload without allocating 10 MB by stubbing head() directly.
    const realHead = env.R2_BUCKET.head.bind(env.R2_BUCKET);
    vi.spyOn(env.R2_BUCKET, "head").mockImplementation(async (key: string) => {
      const obj = await realHead(key);
      return obj ? ({ ...obj, size: MAX_UPLOAD_BYTES + 1 } as R2Object) : obj;
    });
    await env.R2_BUCKET.put(`original/${imageUuid}.webp`, new Uint8Array([0xde]), {
      httpMetadata: { contentType: "image/webp" },
    });

    const request = makeRequest("POST", "/v1/images/complete", { imageUuid });
    const response = await handleComplete(request, env);

    expect(response.status).toBe(422);
    const data = (await response.json()) as { error: string; message: string };
    expect(data.error).toBe("size_exceeded");
    expect(data.message).toContain(String(MAX_UPLOAD_BYTES));
    vi.restoreAllMocks();
  });
});

describe("router", () => {
  it("GET / returns ok", async () => {
    const env = baseEnv();
    const request = makeRequest("GET", "/");
    const response = await handler.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    const data = (await response.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);
  });

  it("returns 404 for unknown routes", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/unknown");
    const response = await handler.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(404);
  });

  it("returns the JSON 500 envelope when R2 head() throws", async () => {
    const env = baseEnv();
    vi.spyOn(env.R2_BUCKET, "head").mockRejectedValue(new Error("R2 outage"));

    const request = makeRequest("POST", "/v1/images/complete", { imageUuid: validUuid() });
    const response = await handler.fetch(request, env, {} as ExecutionContext);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "internal_error",
      message: "internal server error",
    });
    vi.restoreAllMocks();
  });
});

describe("handleComplete auth", () => {
  it("rejects requests with a missing token", async () => {
    const env = baseEnv();
    const imageUuid = validUuid();
    await env.R2_BUCKET.put(`original/${imageUuid}.webp`, new Uint8Array([0xde, 0xad, 0xbe, 0xef]), {
      httpMetadata: { contentType: "image/webp" },
    });

    const request = new Request("https://image-service.example.com/v1/images/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUuid }),
    });
    const response = await handleComplete(request, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "unauthorized",
      message: "missing or invalid service token",
    });
  });
});

describe("metadata sanitization", () => {
  it("strips control and non-ASCII characters from metadata values", async () => {
    const env = baseEnv();
    const imageUuid = validUuid();
    await env.R2_BUCKET.put(`original/${imageUuid}.webp`, new Uint8Array([0xde, 0xad, 0xbe, 0xef]), {
      httpMetadata: { contentType: "image/webp" },
    });

    const request = makeRequest("POST", "/v1/images/complete", {
      imageUuid,
      userId: "  user-id\n🙂  ",
      targetType: "cafe",
      targetId: "c1",
    });

    const response = await handleComplete(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.originalPut.headers["x-amz-meta-userid"]).toBe("user-id");
    expect(data.originalPut.headers["x-amz-meta-targettype"]).toBe("cafe");
    expect(data.originalPut.headers["x-amz-meta-targetid"]).toBe("c1");
  });
});

describe("headObject with R2_ENDPOINT (MinIO dev path)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("HEADs via the S3 client and returns { size } on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { "content-length": "42" } })),
    );
    const env = { ...baseEnv(), R2_ENDPOINT: "http://localhost:9000/" };
    const result = await headObject(env, "original/abc.webp");
    expect(result).toEqual({ size: 42 });

    const [input] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // trailing slash stripped; bucket + key appended (aws4fetch passes a Request)
    expect((input as Request).url).toBe("http://localhost:9000/cafemode/original/abc.webp");
    expect((input as Request).method).toBe("HEAD");
  });

  it("returns null on a non-2xx (missing object / NoSuchBucket)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("NoSuchBucket", { status: 404 })));
    const env = { ...baseEnv(), R2_ENDPOINT: "http://localhost:9000" };
    expect(await headObject(env, "original/abc.webp")).toBeNull();
  });
});
