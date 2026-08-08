import type { CompleteRequest, CompleteResponse, Env, UploadResponse } from "./types";
import { authorized } from "./auth";
import { isValidUUID, sanitizeMetadata } from "./validate";
import { presignedGetUrl, presignedPutUrl, publicUrl, ttlSeconds } from "./r2";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function expirationDate(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function makeKeys(imageUuid: string) {
  return {
    original: `original/${imageUuid}.webp`,
    card: `card/${imageUuid}.webp`,
    thumbnail: `thumbnail/${imageUuid}.webp`,
  };
}

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (!(await authorized(request, env))) {
    return error("unauthorized", 401);
  }

  const imageUuid = crypto.randomUUID().toLowerCase();
  const key = makeKeys(imageUuid).original;
  const { url, headers } = await presignedPutUrl(env, key, "image/webp");

  const response: UploadResponse = {
    imageUuid,
    uploadUrl: url,
    uploadHeaders: headers,
    publicUrl: publicUrl(env, key),
    expiresAt: expirationDate(ttlSeconds(env)),
  };

  return json(response);
}

export async function handleComplete(request: Request, env: Env): Promise<Response> {
  if (!(await authorized(request, env))) {
    return error("unauthorized", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return error("invalid JSON body");
  }

  const { imageUuid, userId, targetType, targetId } = body as CompleteRequest;

  if (!isValidUUID(imageUuid)) {
    return error("imageUuid must be a valid UUID");
  }

  const normalizedUuid = imageUuid.toLowerCase();
  const keys = makeKeys(normalizedUuid);
  const exists = await env.R2_BUCKET.head(keys.original);
  if (!exists) {
    return error("original image not found", 404);
  }

  const metadata: Record<string, string> = {
    uploadDate: new Date().toISOString(),
  };
  const safeUserId = sanitizeMetadata(userId);
  const safeTargetType = sanitizeMetadata(targetType);
  const safeTargetId = sanitizeMetadata(targetId);
  if (safeUserId) metadata.userId = safeUserId;
  if (safeTargetType) metadata.targetType = safeTargetType;
  if (safeTargetId) metadata.targetId = safeTargetId;

  const [originalGet, originalPut, cardPut, thumbnailPut] = await Promise.all([
    presignedGetUrl(env, keys.original),
    presignedPutUrl(env, keys.original, "image/webp", {
      customMetadata: metadata,
      cacheControl: "public, max-age=31536000, immutable",
    }),
    presignedPutUrl(env, keys.card, "image/webp", {
      customMetadata: metadata,
      cacheControl: "public, max-age=31536000, immutable",
    }),
    presignedPutUrl(env, keys.thumbnail, "image/webp", {
      customMetadata: metadata,
      cacheControl: "public, max-age=31536000, immutable",
    }),
  ]);

  const response: CompleteResponse = {
    imageUuid: normalizedUuid,
    original: originalGet,
    originalPut,
    card: cardPut,
    thumbnail: thumbnailPut,
    publicUrls: {
      original: publicUrl(env, keys.original),
      card: publicUrl(env, keys.card),
      thumbnail: publicUrl(env, keys.thumbnail),
    },
    keys,
  };

  return json(response);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (method === "GET" && path === "/") {
        return json({ ok: true, service: "image-service" });
      }

      if (method === "POST" && path === "/v1/images/upload") {
        return handleUpload(request, env);
      }

      if (method === "POST" && path === "/v1/images/complete") {
        return handleComplete(request, env);
      }

      return error("not found", 404);
    } catch (e) {
      console.error("image-service error:", e);
      return error("internal server error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
