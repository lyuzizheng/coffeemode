import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api/response";
import { REVISIT_WINDOW_HOURS, getLastCheckinForCafe } from "@/lib/db/checkins";
import { guard } from "@/lib/api/guard";
import { isValidUUID } from "@shared/uuid";

/**
 * GET /api/checkins/last?cafe_id=<uuid>
 * Returns the caller's most recent check-in for that cafe (for Same-as-last-time
 * and the DG64 same-day-revisit switch) plus the live revisit window, so the
 * drawer derives edit-vs-create from server truth instead of a hardcoded 24h.
 * Requires auth; 401 when unauthenticated, 400 for invalid cafe_id.
 * Returns { checkin: {...} | null, revisitWindowHours: number }.
 */
export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    bucket: "cafes-read",
    requireAuth: true,
    route: "GET /api/checkins/last",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  const cafeId = request.nextUrl.searchParams.get("cafe_id");
  if (!cafeId || !isValidUUID(cafeId)) {
    return apiError("invalid_request", "cafe_id (UUID) required", 400);
  }


  try {
    const checkin = await getLastCheckinForCafe(user.id, cafeId);
    return NextResponse.json({ checkin, revisitWindowHours: REVISIT_WINDOW_HOURS });
  } catch (err) {
    console.error("/api/checkins/last GET failed", err);
    return apiError("internal_error", 500);
  }
}
