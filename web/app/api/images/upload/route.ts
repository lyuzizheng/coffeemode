import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { MAX_UPLOAD_BYTES } from "@/lib/images/constants";
import { ImageServiceError, requestUploadUrl } from "@/lib/images/image-service-client";
import {
  IMAGE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

function parseSize(body: unknown): { size: number } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "size (number, bytes) is required" };
  }
  const maybeSize = (body as Record<string, unknown>).size;
  if (maybeSize === undefined) {
    // Required since review 2026-08-09: an omitted size produced an uncapped
    // presigned PUT (Content-Length is only signed when a size is given).
    return { error: "size (number, bytes) is required" };
  }
  if (typeof maybeSize !== "number" || !Number.isFinite(maybeSize) || maybeSize <= 0) {
    return { error: "size must be a positive number (bytes)" };
  }
  if (maybeSize > MAX_UPLOAD_BYTES) {
    return { error: `size must be at most ${MAX_UPLOAD_BYTES} bytes` };
  }
  return { size: maybeSize };
}

/**
 * POST /api/images/upload
 *
 * Returns a presigned R2 PUT URL for the browser to upload the original WebP image.
 * The session is verified here; the image-service Worker only sees a service token.
 *
 * Body: { size: number } — the file size in bytes. REQUIRED. The presigned URL
 * is signed with a matching Content-Length header so R2 itself rejects bodies
 * over `size`; `size` over MAX_UPLOAD_BYTES is rejected here.
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
    return NextResponse.json({ error: "invalid_request", message: parsed.error }, { status: 400 });
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
