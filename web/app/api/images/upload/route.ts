import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import { ImageServiceError, requestUploadUrl } from "@/lib/images/image-service-client";
import { validateUploadSize } from "@shared/images/validation";
import { guard, readJsonBody } from "@/lib/api/guard";
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

  const gate = await guard(request, {
    bucket: "images",
    requireAuth: true,
    route: "POST /api/images/upload",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = parseSize(bodyRes.data);
  if ("error" in parsed) {
    return apiError(parsed.code, parsed.error, 400);
  }

  try {
    const data = await requestUploadUrl(parsed.size);
    try {
      // Bind the issued imageUuid to this user (issue #33) — complete
      // rejects UUIDs that were never issued to the caller.
      await recordUploadIntent(user.id, data.imageUuid);
    } catch (intentErr) {
      logError({ route: `${gate.route} intent`, request, error: intentErr, status: 500 });
      return apiError("internal_error", 500);
    }
    return NextResponse.json(data);
  } catch (err) {
    logError({ route: gate.route, request, error: err, status: err instanceof ImageServiceError ? err.status : 502 });
    if (err instanceof ImageServiceError) {
      return apiError("image_service_error", err.message, err.status);
    }
    return apiError("image_service_error", 502);
  }
}
