import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { ImageServiceError, requestUploadUrl } from "@/lib/images/image-service-client";
import { validateUploadSize } from "@shared/images/validation";
import {
  IMAGE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

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
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }

  const parsed = parseSize(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.code, message: parsed.error }, { status: 400 });
  }

  const clientId = getClientIdentifier(request, user);
  const limit = rateLimiter.check(
    `images:${clientId}`,
    IMAGE_RATE_LIMIT.windowMs,
    IMAGE_RATE_LIMIT.maxRequests,
  );
  if (!limit.allowed) {
    return rateLimitResponse(limit);
  }

  try {
    const data = await requestUploadUrl(parsed.size);
    return NextResponse.json(data);
  } catch (err) {
    console.error("/api/images/upload failed", err);
    if (err instanceof ImageServiceError) {
      return NextResponse.json(
        { error: "image_service_error", message: err.message },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "image_service_error" }, { status: 502 });
  }
}
