import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { recordUploadIntent } from "@/lib/db/image-uploads";
import { requestUploadUrl } from "@/lib/images/image-service-client";
import { validateUploadSize } from "@shared/images/validation";
import type { ErrorCode } from "@shared/errors";
import { readJsonBody } from "@/lib/api/guard";

function parseSize(
  body: unknown,
): { size: number } | { error: string; code: ErrorCode } {
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
export const POST = apiRoute(
  { bucket: "images", auth: "required", origin: true, route: "POST /api/images/upload" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseSize(bodyRes.data);
    if ("error" in parsed) {
      // Registry status: 400 invalid_request / 413 size_exceeded (spec 0011).
      return apiError(parsed.code, parsed.error, { requestId: ctx.requestId });
    }

    const data = await requestUploadUrl(parsed.size);
    // Bind the issued imageUuid to this user (issue #33) — photo
    // provisioning rejects UUIDs that were never issued to the caller.
    await recordUploadIntent(ctx.user.id, data.imageUuid);
    return NextResponse.json(data);
  },
);
