import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import { ImageServiceError, requestUploadUrl } from "@/lib/images/image-service-client";
import { validateUploadSize } from "@shared/images/validation";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { requireSameOrigin } from "@/lib/security/origin";

function parseSize(
  body: unknown,
): { size: number } | { error: string; code: string } {
  if (!body || typeof body !== "object") {
    return { error: "size (number, bytes) is required", code: "invalid_request" };
  }
  // Rules shared with image-service via web/shared (issue #26):
  // `size` is REQUIRED — an omitted size produced an uncapped presigned PUT
  // (Content-Length is only signed when a size is given).
  const check = validateUploadSize((body as Record<string, unknown>).size);
  if (!check.ok) {
    return {
      error: check.error,
      code: check.code === "size_exceeded" ? "size_exceeded" : "invalid_request",
    };
  }
  return { size: check.size };
}

/**
 * POST /api/images/upload
 *
 * Returns a presigned R2 PUT URL for the browser to upload the original WebP image.
 * The session is verified here; the image-service Worker only sees a service token.
 *
 * Body: { size: number } — the file size in bytes. REQUIRED. Must be a positive
 * integer. The presigned URL is signed with a matching Content-Length header so
 * R2 itself rejects bodies over `size`; `size` over MAX_UPLOAD_BYTES is rejected here.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const body = await request.json().catch(() => undefined);
  const parsed = parseSize(body);
  if ("error" in parsed) {
    return apiError(parsed.code, parsed.error, 400);
  }

  const clientId = getClientIdentifier(request, user);
  const limit = await checkRateLimit(
    "images",
    clientId,
    rateLimitBuckets("images"),
    "POST /api/images/upload",
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  try {
    const data = await requestUploadUrl(parsed.size);
    try {
      // Bind the issued imageUuid to this user (issue #33) — complete
      // rejects UUIDs that were never issued to the caller.
      await recordUploadIntent(user.id, data.imageUuid);
    } catch (intentErr) {
      console.error("/api/images/upload intent record failed", intentErr);
      return apiError("internal_error", 500);
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("/api/images/upload failed", err);
    if (err instanceof ImageServiceError) {
      return apiError("image_service_error", err.message, err.status);
    }
    return apiError("image_service_error", 502);
  }
}
