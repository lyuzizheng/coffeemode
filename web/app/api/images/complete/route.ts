import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { isValidUUID } from "@shared/uuid";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
  isImageServiceError,
} from "@/lib/images/complete";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
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

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return apiError("invalid_request", "invalid JSON body", 400);
  }

  const req = validateBody(body);
  if (!req) {
    return apiError(
      "invalid_request",
      "valid imageUuid, targetType (cafe|checkin), and targetId required",
      400,
    );
  }

  const clientId = getClientIdentifier(request, user);
  const limit = await checkRateLimit(
    "images",
    clientId,
    rateLimitBuckets("images"),
    "POST /api/images/complete",
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  try {
    const result = await completeImageUpload(user, req, defaultCompleteUploadDeps());
    if (!result.attached || !result.storedImage || !result.processed) {
      return apiError("not_found", "target not found or not owned by user", 404);
    }

    const response: CompleteImageResponse = {
      imageUuid: result.processed.imageUuid,
      publicUrls: result.processed.publicUrls,
      width: result.processed.width,
      height: result.processed.height,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("/api/images/complete failed", err);
    if (isImageServiceError(err)) {
      return apiError("image_service_error", err.message, err.status);
    }
    return apiError("image_processing_error", 502);
  }
}
