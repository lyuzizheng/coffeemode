import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { toggleCheckInLike } from "@/lib/db/checkins";
import { isValidUUID } from "@shared/uuid";

/**
 * POST /api/checkins/[id]/like
 * Toggle the current user's like on a check-in; the CTE keeps
 * checkins.likes_count in sync atomically. Returns {liked, likes_count}.
 * Requires auth; 404 when the check-in is missing, soft-deleted, or on a
 * private cafe the caller cannot see (BRAWUKA-634);
 * 403 self_like_forbidden when the caller tries to like their own check-in.
 */
export const POST = apiRoute<{ id: string }>(
  { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/checkins/[id]/like" },
  async (_request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const result = await toggleCheckInLike(ctx.user.id, id);
    return NextResponse.json(result);
  },
);
