import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { isValidUUID } from "@shared/uuid";
import {
  completeImageUpload,
  defaultCompleteUploadDeps,
  isImageServiceError,
} from "@/lib/images/complete";
import {
  IMAGE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import type { CompleteImageRequest, CompleteImageResponse, ImageTargetType } from "@/types/images";

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
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const req = validateBody(body);
  if (!req) {
    return NextResponse.json(
      { error: "invalid_request", message: "valid imageUuid, targetType (cafe|checkin), and targetId required" },
      { status: 400 },
    );
  }

  const clientId = getClientIdentifier(request, user);
  const limit = await rateLimiter.check(
    `images:${clientId}`,
    IMAGE_RATE_LIMIT.windowMs,
    IMAGE_RATE_LIMIT.maxRequests,
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  try {
    const result = await completeImageUpload(user, req, defaultCompleteUploadDeps());
    if (!result.attached || !result.storedImage || !result.processed) {
      return NextResponse.json(
        { error: "not_found", message: "target not found or not owned by user" },
        { status: 404 },
      );
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
      return NextResponse.json(
        { error: "image_service_error", message: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "image_processing_error" }, { status: 502 });
  }
}
