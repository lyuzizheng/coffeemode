import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { getLastCheckinForCafe } from "@/lib/db/checkins";
import { REVISIT_WINDOW_HOURS } from "@/lib/validation/checkin";
import { isValidUUID } from "@shared/uuid";

/**
 * GET /api/checkins/last?cafe_id=<uuid>
 * Returns the caller's most recent check-in for that cafe (for Same-as-last-time
 * and the DG64 same-day-revisit switch) plus the live revisit window, so the
 * drawer derives edit-vs-create from server truth instead of a hardcoded 24h.
 * Requires auth; 401 when unauthenticated, 400 for invalid cafe_id.
 * Returns { checkin: {...} | null, revisit_window_hours: number }.
 */
export const GET = apiRoute(
  { bucket: "cafes-read", auth: "required", route: "GET /api/checkins/last" },
  async (request, ctx) => {
    const cafeId = new URL(request.url).searchParams.get("cafe_id");
    if (!cafeId || !isValidUUID(cafeId)) {
      return apiError("invalid_request", "cafe_id (UUID) required", { status: 400, requestId: ctx.requestId });
    }

    const checkin = await getLastCheckinForCafe(ctx.user.id, cafeId);
    return NextResponse.json({ checkin, revisit_window_hours: REVISIT_WINDOW_HOURS });
  },
);
