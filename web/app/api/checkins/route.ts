import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { createCheckIn } from "@/lib/db/checkins";
import {
  CafeNotFoundError,
  DuplicateCheckInError,
  parseCheckInBody,
} from "@/lib/validation/checkin";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import { ImageServiceError } from "@/lib/images/image-service-client";
import { guard, readJsonBody } from "@/lib/api/guard";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/checkins  {cafe_id, scores?, max_stay?, note?, photo_ids?, visited_at?, idempotency_key?}
 * Regular (non-creation) check-in: insert + gallery merge + work_stats
 * fold in one transaction (spec 0001). Requires auth. 404 when the cafe
 * server provisions and derives them (issue #86) — 400 invalid_photos
 * when an id was not issued to the caller or was already consumed.
 * DG61: a replayed idempotency_key returns the original {checkinId} with
 * 200 and writes nothing; a fresh write returns 201.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = parseCheckInBody(bodyRes.data);
  if (!parsed.ok) {
    return apiError("invalid_request", parsed.message, 400);
  }

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "POST /api/checkins",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const result = await createCheckIn(user.id, parsed.value);
    // DG61: a replayed idempotency key returns the ORIGINAL id with the
    // same body shape — 200 marks "already recorded" so retries are
    // observable, 201 marks a fresh write.
    return NextResponse.json({ checkinId: result.checkinId }, { status: result.deduped ? 200 : 201 });
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return apiError("not_found", "cafe not found", 404);
    }
    if (err instanceof DuplicateCheckInError) {
      // DG64: same-day revisit — never a user-facing error. The drawer
      // preempts this via GET /api/checkins/last; raced clients (multi-tab)
      // convert to PATCH on the returned id without surfacing it.
      return apiError("duplicate_checkin", "check-in already exists for this visit", 409, {
        existing_checkin_id: err.existingCheckinId,
      });
    }
    if (
      err instanceof PhotoIntentError ||
      // The caller's own upload never landed in R2 (worker 404) — same
      // user-facing class as a bad photo id, not a server fault.
      (err instanceof ImageServiceError && err.status === 404)
    ) {
      return apiError("invalid_photos", "one or more photos are invalid", 400);
    }
    logError({ route: gate.route, request, error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
