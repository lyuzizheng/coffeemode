import { describe, expect, it } from "vitest";
import handler, { handleComplete, handleUpload } from "../src/index";
import { MAX_UPLOAD_BYTES } from "../src/constants";
import { baseEnv } from "./helpers";

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
      "x-image-service-token": "test-token",
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
    const request = makeRequest("POST", "/v1/images/upload");
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
    const request = makeRequest("POST", "/v1/images/upload");
    const response = await handleUpload(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.uploadUrl).toContain("X-Amz-Expires=120");
    const ttlMs = new Date(data.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(110_000);
    expect(ttlMs).toBeLessThanOrEqual(120_000);
  });

  it("includes the max upload size in the response", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload");
    const response = await handleUpload(request, env);
    const data = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(data.maxUploadBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it("rejects uploads larger than the 10 MB cap", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/upload", {
      size: MAX_UPLOAD_BYTES + 1,
    });
    const response = await handleUpload(request, env);

    expect(response.status).toBe(413);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain("exceeds maximum");
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

  it("rejects requests without a token", async () => {
    const env = baseEnv();
    const request = new Request("https://image-service.example.com/v1/images/upload", {
      method: "POST",
    });
    const response = await handleUpload(request, env);
    expect(response.status).toBe(401);
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
  });

  it("rejects invalid UUIDs", async () => {
    const env = baseEnv();
    const request = makeRequest("POST", "/v1/images/complete", { imageUuid: "not-a-uuid" });
    const response = await handleComplete(request, env);
    expect(response.status).toBe(400);
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


