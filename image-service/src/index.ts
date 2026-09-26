import type { CompleteRequest, CompleteResponse, DeleteRequest, DeleteResponse, Env, UploadResponse } from "./types";
import { authorized, internalError, json, unauthorized } from "./auth";
import type { ErrorCode } from "../../web/shared/errors";
import { defaultErrorStatus } from "../../web/shared/errors";
import { logError, logWarn } from "../../web/shared/log";
import { isValidUUID } from "../../web/shared/uuid";
import { validateUploadSize } from "../../web/shared/images/validation";
import { imageKeys } from "../../web/shared/images/keys";
import { sanitizeMetadata } from "./validate";
import { deleteObjects, headObject, presignedGetUrl, presignedPutUrl, publicUrl, ttlSeconds } from "./r2";
import { IMMUTABLE_CACHE_CONTROL, MAX_UPLOAD_BYTES, PROVISION_TARGET_TYPE } from "./constants";

/** Validation failure envelope — same shape as poi-service
 * ({ error: code, message?, request_id }). `code` is registry-typed and the
 * status defaults to the registry's canonical status for it. */
function error(request: Request, code: ErrorCode, message: string, status?: number): Response {
  return json({ error: code, message }, status ?? defaultErrorStatus(code), request);
}

function expirationDate(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(request, "invalid_request", "invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return error(request, "invalid_request", "invalid JSON body");
  }

  // `size` is REQUIRED: an omitted size produced an uncapped presigned PUT,
  // because Content-Length is only signed when a size is declared. The cap
  // must hold server-side, not by caller honesty. Rules shared with the web
  // upload route via web/shared (issue #26).
  const sizeCheck = validateUploadSize((body as Record<string, unknown>).size);
  if (!sizeCheck.ok) {
    const code = sizeCheck.code === "size_exceeded" ? "size_exceeded" : "invalid_request";
    return error(request, code, sizeCheck.error);
  }
  const size = sizeCheck.size;

  const imageUuid = crypto.randomUUID().toLowerCase();
  const keys = imageKeys(imageUuid);
  // The browser capability is scoped to the STAGING key (BRAWUKA-730). It
  // stays valid for the URL TTL, so it must never name a published key: a
  // repeated PUT after processing would otherwise replace the published
  // original and strip its completion metadata/cache headers.
  // Content-Length is signed into the PUT so R2 rejects mismatched bodies.
  const { url, headers } = await presignedPutUrl(env, keys.staging, "image/webp", {
    contentLength: size,
  });

  const response: UploadResponse = {
    imageUuid,
    uploadUrl: url,
    uploadHeaders: headers,
    // Published address this upload occupies once processed; the staged
    // object itself is never public.
    publicUrl: publicUrl(env, keys.original),
    expiresAt: expirationDate(ttlSeconds(env)),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    size,
  };

  return json(response, 200, request);
}

export async function handleComplete(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(request, "invalid_request", "invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    return error(request, "invalid_request", "invalid JSON body");
  }

  const { imageUuid, userId, targetType, targetId } = body as CompleteRequest;

  if (!isValidUUID(imageUuid)) {
    return error(request, "invalid_request", "imageUuid must be a valid UUID");
  }

  // Stage metadata is REQUIRED (issue #158 cleanup contract): complete()
  // stamps it onto the re-PUT original, so a completed original without a
  // marker would be deletable. Two stages are accepted:
  //   - provision: targetType="provision", targetId=<imageUuid> — the creation
  //     flow processes images BEFORE their cafe/check-in target exists
  //     (issue #86); attachProvisionedPhotos restamps via restampOriginal
  //     with the real target once it exists.
  //   - final: targetType="cafe"|"checkin" + target id — live gallery original.
  // The cleanup script treats "provision"-stage objects older than retention
  // as abandoned (an upload that never attached) and keeps cafe/checkin ones.
  const safeUserId = sanitizeMetadata(userId);
  const safeTargetType = sanitizeMetadata(targetType);
  const safeTargetId = sanitizeMetadata(targetId);
  if (!safeTargetType || !safeTargetId) {
    return error(request, "invalid_request", "targetType and targetId are required");
  }
  // Keys are always lowercase (normalizedUuid); the provision marker must
  // match the key case so metadata and key stay consistent (BRAWUKA-455).
  const normalizedUuid = imageUuid.toLowerCase();
  let metadataTargetId: string = safeTargetId;
  if (
    safeTargetType !== PROVISION_TARGET_TYPE &&
    safeTargetType !== "cafe" &&
    safeTargetType !== "checkin"
  ) {
    return error(request, "invalid_request", "targetType must be provision, cafe, or checkin");
  }
  if (safeTargetType === PROVISION_TARGET_TYPE) {
    // Provision-stage marker pairs the object with itself: unique per upload,
    // never collides with a real cafe/checkin UUID.
    metadataTargetId = normalizedUuid;
  }

  const keys = imageKeys(normalizedUuid);
  // The download URL follows the stage (BRAWUKA-730): the creation flow
  // (provision) reads the staged raw upload it is about to publish; the
  // post-commit attach leg re-stamps the already published original. Both
  // legs write the published keys below — the browser never holds a
  // capability for any of them.
  const sourceKey = safeTargetType === PROVISION_TARGET_TYPE ? keys.staging : keys.original;
  const exists = await headObject(env, sourceKey);
  if (!exists) {
    return error(request, "not_found", "original image not found");
  }
  // Enforce the cap on the ACTUAL uploaded bytes, not the caller's claim
  // (review 2026-08-09): refuse to hand out process URLs for oversized
  // objects.
  if (exists.size > MAX_UPLOAD_BYTES) {
    return error(
      request,
      "size_exceeded",
      `uploaded object is ${exists.size} bytes, exceeding the ${MAX_UPLOAD_BYTES} byte cap`,
    );
  }

  const metadata: Record<string, string> = {
    uploadDate: new Date().toISOString(),
  };
  if (safeUserId) metadata.userId = safeUserId;
  metadata.targetType = safeTargetType;
  metadata.targetId = metadataTargetId;

  const [originalGet, originalPut, cardPut, thumbnailPut] = await Promise.all([
    presignedGetUrl(env, sourceKey),
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
    keys: { original: keys.original, card: keys.card, thumbnail: keys.thumbnail },
  };

  return json(response, 200, request);
}

/**
 * Best-effort compensation for the web creation/complete flows (BRAWUKA-279):
 * after `processImage` writes variants to R2, a DB transaction may still roll
 * back (duplicate check-in, consumed intent, unique conflict). The caller then
 * POSTs here to delete the orphaned variants. Variant keys are derived
 * server-side from `imageUuid`, so a caller cannot delete arbitrary objects;
 * missing keys are reported, never errors (idempotent retries). The staged
 * upload is a target too (BRAWUKA-730): once the id is unreferenced and its
 * intent is gone, the raw bytes are garbage. With `keepOriginal: true` only
 * the derived variants (`card/`, `thumbnail/`) are deleted — the staged
 * upload and the published original survive so a retry can re-derive them.
 */
export async function handleDelete(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(request, "invalid_request", "invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    return error(request, "invalid_request", "invalid JSON body");
  }

  const record = body as DeleteRequest & Record<string, unknown>;
  const imageUuid = record.imageUuid;
  if (typeof imageUuid !== "string" || !isValidUUID(imageUuid)) {
    return error(request, "invalid_request", "imageUuid must be a valid UUID");
  }
  const keepOriginal = record.keepOriginal === true;

  const normalizedUuid = imageUuid.toLowerCase();
  const keys = imageKeys(normalizedUuid);
  const targets = keepOriginal
    ? [keys.card, keys.thumbnail]
    : [keys.staging, keys.original, keys.card, keys.thumbnail];
  const { deleted, missing } = await deleteObjects(env, targets);
  const response: DeleteResponse = { imageUuid: normalizedUuid, deleted, missing };
  return json(response, 200, request);
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (method === "GET" && (path === "/" || path === "/health")) {
        return json({ ok: true, service: "image-service" }, 200, request);
      }

      // Global auth gate (spec 0011 D6): every non-health route requires the
      // service token, in the same position as poi-service's gate — the
      // per-handler `authorized()` checks are gone, so the order can never
      // drift again. A missing env token is a misconfig: fail closed but log
      // one warn line so the silence is diagnosable.
      if (!(await authorized(request, env))) {
        logWarn({ route: "auth", request, error: "unauthorized", status: 401, code: "unauthorized" });
        return unauthorized(request);
      }

      if (method === "POST" && path === "/v1/images/upload") {
        return await handleUpload(request, env);
      }

      if (method === "POST" && path === "/v1/images/complete") {
        return await handleComplete(request, env);
      }

      if (method === "POST" && path === "/v1/images/delete") {
        return await handleDelete(request, env);
      }
      return error(request, "not_found", "route not found");
    } catch (e) {
      logError({ route: "image-service", request, error: e, status: 500, code: "internal_error" });
      return internalError(request);
    }
  },
} satisfies ExportedHandler<Env>;
