import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import {
  CheckInNotFoundError,
  SelfLikeError,
  toggleCheckInLike,
} from "@/lib/db/checkins";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { isValidUUID } from "@shared/uuid";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/checkins/[id]/like
 * Toggle the current user's like on a check-in; the CTE keeps
 * checkins.likes_count in sync atomically. Returns {liked, likesCount}.
 * Requires auth; 404 when the check-in is missing or soft-deleted;
 * 403 self_like_forbidden when the caller tries to like their own check-in.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "id must be a UUID", 400);
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
    "POST /api/checkins/[id]/like",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const result = await toggleCheckInLike(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CheckInNotFoundError) {
      return apiError("not_found", "check-in not found", 404);
    }
    if (err instanceof SelfLikeError) {
      return apiError("self_like_forbidden", "you cannot like your own check-in", 403);
    }
    console.error("/api/checkins/[id]/like POST failed", err);
    return apiError("internal_error", 500);
  }
}
