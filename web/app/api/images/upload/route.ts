import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { ImageServiceError, requestUploadUrl } from "@/lib/images/image-service-client";
import {
  IMAGE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

function parseSize(body: unknown): { size?: number; error?: string } {
  if (!body || typeof body !== "object") return {};
  const maybeSize = (body as Record<string, unknown>).size;
  if (maybeSize === undefined) return {};
  if (typeof maybeSize !== "number" || !Number.isFinite(maybeSize) || maybeSize <= 0) {
    return { error: "size must be a positive number (bytes)" };
  }
  return { size: maybeSize };
}

/**
 * POST /api/images/upload
 *
 * Returns a presigned R2 PUT URL for the browser to upload the original WebP image.
 * The session is verified here; the image-service Worker only sees a service token.
 *
 * Body (optional): { size?: number } — the file size in bytes. When provided,
 * the presigned URL is signed with a matching Content-Length header so R2 can
 * enforce the 10 MB cap.
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

  const { size, error: sizeError } = parseSize(body);
  if (sizeError) {
    return NextResponse.json({ error: "invalid_request", message: sizeError }, { status: 400 });
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
    const data = await requestUploadUrl(size);
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
