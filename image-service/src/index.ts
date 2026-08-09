import type { CompleteRequest, CompleteResponse, Env, UploadResponse } from "./types";
import { authorized, internalError, json, unauthorized } from "./auth";
import { isValidUUID } from "../../web/shared/uuid";
import { validateUploadSize } from "../../web/shared/images/validation";
import { sanitizeMetadata } from "./validate";
import { presignedGetUrl, presignedPutUrl, publicUrl, ttlSeconds } from "./r2";
import { IMMUTABLE_CACHE_CONTROL, MAX_UPLOAD_BYTES } from "./constants";

/** Validation failure envelope — same shape as poi-service
 *  ({ error: code, message? }). */
function error(code: string, message: string, status = 400): Response {
  return json({ error: code, message }, status);
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
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("invalid_request", "invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return error("invalid_request", "invalid JSON body");
  }

  // `size` is REQUIRED: an omitted size produced an uncapped presigned PUT,
  // because Content-Length is only signed when a size is declared. The cap
  // must hold server-side, not by caller honesty. Rules shared with the web
  // upload route via web/shared (issue #26).
  const sizeCheck = validateUploadSize((body as Record<string, unknown>).size);
  if (!sizeCheck.ok) {
    const code = sizeCheck.code === "size_exceeded" ? "size_exceeded" : "invalid_request";
    return error(code, sizeCheck.error);
  }
  const size = sizeCheck.size;

  const imageUuid = crypto.randomUUID().toLowerCase();
  const key = makeKeys(imageUuid).original;
  // Content-Length is signed into the PUT so R2 rejects mismatched bodies.
  const { url, headers } = await presignedPutUrl(env, key, "image/webp", {
    contentLength: size,
  });

  const response: UploadResponse = {
    imageUuid,
    uploadUrl: url,
    uploadHeaders: headers,
    publicUrl: publicUrl(env, key),
    expiresAt: expirationDate(ttlSeconds(env)),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    size,
  };

  return json(response);
}

export async function handleComplete(request: Request, env: Env): Promise<Response> {
  if (!(await authorized(request, env))) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("invalid_request", "invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return error("invalid_request", "invalid JSON body");
  }

  const { imageUuid, userId, targetType, targetId } = body as CompleteRequest;

  if (!isValidUUID(imageUuid)) {
    return error("invalid_request", "imageUuid must be a valid UUID");
  }

  const normalizedUuid = imageUuid.toLowerCase();
  const keys = makeKeys(normalizedUuid);
  const exists = await env.R2_BUCKET.head(keys.original);
  if (!exists) {
    return error("not_found", "original image not found", 404);
  }
  // Enforce the cap on the ACTUAL uploaded bytes, not the caller's claim
  // (review 2026-08-09): refuse to hand out process URLs for oversized
  // objects.
  if (exists.size > MAX_UPLOAD_BYTES) {
    return error(
      "size_exceeded",
      `uploaded object is ${exists.size} bytes, exceeding the ${MAX_UPLOAD_BYTES} byte cap`,
      422,
    );
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
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
    presignedPutUrl(env, keys.card, "image/webp", {
      customMetadata: metadata,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
    presignedPutUrl(env, keys.thumbnail, "image/webp", {
      customMetadata: metadata,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
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
        return await handleUpload(request, env);
      }

      if (method === "POST" && path === "/v1/images/complete") {
        return await handleComplete(request, env);
      }

      return error("not_found", "route not found", 404);
    } catch (e) {
      console.error("image-service error:", e);
      return internalError();
    }
  },
} satisfies ExportedHandler<Env>;
