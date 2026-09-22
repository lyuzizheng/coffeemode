import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { cafeExists } from "@/lib/db/cafes";
import {
  FEED_MODES,
  listPublicCheckIns,
} from "@/lib/discovery/feed";
import { isValidUUID } from "@shared/uuid";
import type { CheckInFeedMode } from "@/types/checkins";

/**
 * GET /api/cafes/[id]/checkins?mode=&cursor=
 * Public check-in feed for the discovery sheet (spec 0001). Anonymous read,
 * rate limited; `mode` defaults to `newest` (DG113) and cursors are
 * mode-bound — a cursor issued for another mode is a 400, never a silent
 * reset. 404 when the cafe does not exist (drives the in-app missing-cafe
 * recovery flow). Existence uses the narrow `cafeExists` probe (BRAWUKA-279:
 * `select 1`, same visibility semantics) — never the wide `getCafe` row.
 */
export const GET = apiRoute<{ id: string }>(
  { bucket: "cafes-read", route: "GET /api/cafes/[id]/checkins" },
  async (request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const url = new URL(request.url);
    const modeParam = url.searchParams.get("mode") ?? "newest";
    if (!FEED_MODES.includes(modeParam as CheckInFeedMode)) {
      return apiError("invalid_request", `mode must be one of: ${FEED_MODES.join(", ")}`, { status: 400, requestId: ctx.requestId });
    }
    const mode = modeParam as CheckInFeedMode;
    const cursor = url.searchParams.get("cursor") ?? undefined;

    // Probe and page run in parallel (BRAWUKA-649): the feed query is
    // existence-agnostic, so the 404 check reads the probe result after both
    // settle instead of serializing a second DB RTT behind it.
    const [exists, page] = await Promise.all([
      cafeExists(id, ctx.user?.id),
      listPublicCheckIns({
        cafeId: id,
        mode,
        cursor,
        viewerId: ctx.user?.id ?? null,
      }),
    ]);
    if (!exists) {
      return apiError("not_found", "cafe not found", { status: 404, requestId: ctx.requestId });
    }
    return NextResponse.json(page);
  },
);
