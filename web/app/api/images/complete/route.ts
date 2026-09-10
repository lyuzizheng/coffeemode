import { getRequestId, logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { isValidUUID } from "@shared/uuid";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
  isImageServiceError,
} from "@/lib/images/complete";
import { guard, readJsonBody } from "@/lib/api/guard";
import type { CompleteImageRequest, CompleteImageResponse, ImageTargetType } from "@/types/images";
import { requireSameOrigin } from "@/lib/security/origin";

export const runtime = "nodejs";

function validateBody(body: unknown): CompleteImageRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.imageUuid !== "string" || typeof b.targetId !== "string") return null;
  if (b.targetType !== "cafe" && b.targetType !== "checkin") return null;
  const imageUuid = b.imageUuid.toLowerCase();
  const targetId = b.targetId.toLowerCase();
  if (!isValidUUID(imageUuid) || !isValidUUID(targetId)) return null;
  return {
    imageUuid,
    targetType: b.targetType as ImageTargetType,
    targetId,
    isCover: b.isCover === true,
  };
}

/**
 * POST /api/images/complete
 *
 * Thin controller: auth, body validation, rate limiting, error mapping.
 * Ownership, remote processing and the atomic DB writes live in
 * `web/lib/images/complete.ts` (issue #25).
 *
 * Called by the browser after it has uploaded the original to R2.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const gate = await guard(request, {
    bucket: "images",
    requireAuth: true,
    route: "POST /api/images/complete",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const body = bodyRes.data;

  const req = validateBody(body);
  if (!req) {
    return apiError(
      "invalid_request",
      "valid imageUuid, targetType (cafe|checkin), and targetId required",
      400,
    );
  }


  try {
    const result = await completeImageUpload(user, req, defaultCompleteUploadDeps());
    if (!result.ok) {
      switch (result.reason) {
        case "intent_not_found":
          return apiError("forbidden", "upload intent invalid or not issued to user", 403);
        case "not_owned":
          return apiError("not_found", "target not found or not owned by user", 404);
        case "intent_consumed":
          return apiError("conflict", "upload intent already consumed", 409);
        case "target_gone":
          return apiError("not_found", "target not found or no longer owned", 404);
      }
    }

    const response: CompleteImageResponse = {
      imageUuid: result.processed.imageUuid,
      publicUrls: result.processed.publicUrls,
      width: result.processed.width,
      height: result.processed.height,
    };

    return NextResponse.json(response);
  } catch (err) {
    logError({ route: "POST /api/images/complete", requestId: getRequestId(request), error: err, status: isImageServiceError(err) ? err.status : 502 });
    if (isImageServiceError(err)) {
      return apiError("image_service_error", err.message, err.status);
    }
    return apiError("image_processing_error", 502);
  }
}
