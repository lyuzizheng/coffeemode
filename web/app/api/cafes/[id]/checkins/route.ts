import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { getCafe } from "@/lib/db/cafes";
import {
  FEED_MODES,
  FeedCursorError,
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
import { isValidUUID } from "@shared/uuid";
import type { CheckInFeedMode } from "@/types/checkins";

/**
 * GET /api/cafes/[id]/checkins?mode=&cursor=
 * Public check-in feed for the discovery sheet (spec 0001). Anonymous read,
 * rate limited; `mode` defaults to `newest` (DG113) and cursors are
 * mode-bound — a cursor issued for another mode is a 400, never a silent
 * reset. 404 when the cafe does not exist (drives the in-app missing-cafe
 * recovery flow).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "id must be a UUID", 400);
  }

  const url = new URL(request.url);
  const modeParam = url.searchParams.get("mode") ?? "newest";
  if (!FEED_MODES.includes(modeParam as CheckInFeedMode)) {
    return apiError("invalid_request", `mode must be one of: ${FEED_MODES.join(", ")}`, 400);
  }
  const mode = modeParam as CheckInFeedMode;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-read",
    clientId,
    rateLimitBuckets("cafes-read"),
    "GET /api/cafes/[id]/checkins",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const cafe = await getCafe(id);
    if (!cafe) {
      return apiError("not_found", "cafe not found", 404);
    }
    const page = await listPublicCheckIns({
      cafeId: id,
      mode,
      cursor,
      viewerId: user?.id ?? null,
    });
    return NextResponse.json(page);
  } catch (err) {
    if (err instanceof FeedCursorError) {
      return apiError("invalid_request", "cursor is invalid or was issued for another mode", 400);
    }
    console.error("/api/cafes/[id]/checkins GET failed", err);
    return apiError("internal_error", 500);
  }
}
