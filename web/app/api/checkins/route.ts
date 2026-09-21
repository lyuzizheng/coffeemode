import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { createCheckIn } from "@/lib/db/checkins";
import { parseCheckInBody } from "@/lib/validation/checkin";
import { readJsonBody } from "@/lib/api/guard";

/**
 * POST /api/checkins  {cafe_id, scores?, max_stay?, note?, photo_ids?, visited_at?, idempotency_key?}
 * Regular (non-creation) check-in: insert + gallery merge + work_stats
 * fold in one transaction (spec 0001). Requires auth. 404 when the cafe
 * does not exist. Photos are image UUIDs from /api/images/upload; the
 * server provisions and derives them (issue #86) — 422 invalid_photos
 * when an id was not issued to the caller or was already consumed.
 * DG61: a replayed idempotency_key returns the original {checkin_id} with
 * 200 and writes nothing; a fresh write returns 201.
 */
export const POST = apiRoute(
  { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/checkins" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseCheckInBody(bodyRes.data);
    if (!parsed.ok) {
      return apiError("invalid_request", parsed.message, { status: 400, requestId: ctx.requestId });
    }

    const result = await createCheckIn(ctx.user.id, parsed.value);
    // DG61: a replayed idempotency key returns the ORIGINAL id with the
    // same body shape — 200 marks "already recorded" so retries are
    // observable, 201 marks a fresh write.
    return NextResponse.json({ checkin_id: result.checkin_id }, { status: result.deduped ? 200 : 201 });
  },
);
