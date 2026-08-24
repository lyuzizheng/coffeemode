import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getCafe } from "@/lib/db/cafes";
import {
  FEED_MODES,
  FeedCursorError,
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import {
  CAFES_READ_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
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
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const modeParam = url.searchParams.get("mode") ?? "newest";
  if (!FEED_MODES.includes(modeParam as CheckInFeedMode)) {
    return NextResponse.json(
      { error: "invalid_request", message: `mode must be one of: ${FEED_MODES.join(", ")}` },
      { status: 400 },
    );
  }
  const mode = modeParam as CheckInFeedMode;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `cafes-read:${clientId}`,
    CAFES_READ_RATE_LIMIT.windowMs,
    CAFES_READ_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const cafe = await getCafe(id);
    if (!cafe) {
      return NextResponse.json(
        { error: "not_found", message: "cafe not found" },
        { status: 404 },
      );
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
      return NextResponse.json(
        { error: "invalid_request", message: "cursor is invalid or was issued for another mode" },
        { status: 400 },
      );
    }
    console.error("/api/cafes/[id]/checkins GET failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
