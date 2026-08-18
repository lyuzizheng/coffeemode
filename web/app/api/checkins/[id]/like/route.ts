import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  CheckInNotFoundError,
  SelfLikeError,
  toggleCheckInLike,
} from "@/lib/db/checkins";
import {
  CAFES_WRITE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { isValidUUID } from "@shared/uuid";

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
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `checkins-like:${clientId}`,
    CAFES_WRITE_RATE_LIMIT.windowMs,
    CAFES_WRITE_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const result = await toggleCheckInLike(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CheckInNotFoundError) {
      return NextResponse.json(
        { error: "not_found", message: "check-in not found" },
        { status: 404 },
      );
    }
    if (err instanceof SelfLikeError) {
      return NextResponse.json(
        { error: "self_like_forbidden", message: "you cannot like your own check-in" },
        { status: 403 },
      );
    }
    console.error("/api/checkins/[id]/like POST failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
