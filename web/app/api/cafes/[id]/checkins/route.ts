import { getRequestId, logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { getCafe } from "@/lib/db/cafes";
import {
  FEED_MODES,
  FeedCursorError,
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import { guard } from "@/lib/api/guard";
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

  const gate = await guard(request, {
    bucket: "cafes-read",
    route: "GET /api/cafes/[id]/checkins",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const cafe = await getCafe(id, user?.id);
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
    logError({ route: "GET /api/cafes/[id]/checkins", requestId: getRequestId(request), error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
