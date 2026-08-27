import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import {
  CafeNotFoundError,
  createCheckIn,
  parseCheckInBody,
} from "@/lib/db/checkins";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import { ImageServiceError } from "@/lib/images/image-service-client";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/checkins  {cafe_id, scores?, max_stay?, note?, photo_ids?, visited_at?}
 * Regular (non-creation) check-in: insert + gallery merge + work_stats
 * fold in one transaction (spec 0001). Requires auth. 404 when the cafe
 * does not exist. Photos are image UUIDs from /api/images/upload; the
 * server provisions and derives them (issue #86) — 400 invalid_photos
 * when an id was not issued to the caller or was already consumed.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => null);
  const parsed = parseCheckInBody(body);
  if (!parsed.ok) {
    return apiError("invalid_request", parsed.message, 400);
  }

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-write",
    clientId,
    rateLimitBuckets("cafes-write"),
    "POST /api/checkins",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const result = await createCheckIn(user.id, parsed.value);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return apiError("not_found", "cafe not found", 404);
    }
    if (
      err instanceof PhotoIntentError ||
      // The caller's own upload never landed in R2 (worker 404) — same
      // user-facing class as a bad photo id, not a server fault.
      (err instanceof ImageServiceError && err.status === 404)
    ) {
      return apiError("invalid_photos", "one or more photos are invalid", 400);
    }
    console.error("/api/checkins POST failed", err);
    return apiError("internal_error", 500);
  }
}
