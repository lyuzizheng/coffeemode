import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { REVISIT_WINDOW_HOURS, getLastCheckinForCafe } from "@/lib/db/checkins";
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
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
  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const cafeId = request.nextUrl.searchParams.get("cafe_id");
  if (!cafeId || !isValidUUID(cafeId)) {
    return apiError("invalid_request", "cafe_id (UUID) required", 400);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-read",
    clientId,
    rateLimitBuckets("cafes-read"),
    "GET /api/checkins/last",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const checkin = await getLastCheckinForCafe(user.id, cafeId);
    return NextResponse.json({ checkin, revisitWindowHours: REVISIT_WINDOW_HOURS });
  } catch (err) {
    console.error("/api/checkins/last GET failed", err);
    return apiError("internal_error", 500);
  }
}
