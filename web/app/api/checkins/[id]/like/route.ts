import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { toggleCheckInLike } from "@/lib/db/checkins";
import {
  CheckInNotFoundError,
  SelfLikeError,
} from "@/lib/validation/checkin";
import { guard } from "@/lib/api/guard";
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

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "POST /api/checkins/[id]/like",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

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
