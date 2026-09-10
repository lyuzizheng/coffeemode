import { getRequestId, logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { softDeleteCheckIn, updateCheckIn } from "@/lib/db/checkins";
import {
  CheckInForbiddenError,
  CheckInNotFoundError,
  parseUpdateCheckInBody,
} from "@/lib/validation/checkin";
import { guard, readJsonBody } from "@/lib/api/guard";
import { isValidUUID } from "@shared/uuid";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * PATCH /api/checkins/[id]
 * Edit the caller's own check-in (scores, policies, note, visited_at).
 * Requires auth. 404 when missing or soft-deleted. 403 when not the author.
 * 400 when the body is invalid. Photos are not edited via this endpoint
 * (creation-time photos are fixed; use a new check-in for new photos).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "id must be a UUID", 400);
  }

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = parseUpdateCheckInBody(bodyRes.data);
  if (!parsed.ok) {
    return apiError("invalid_request", parsed.message, 400);
  }

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "PATCH /api/checkins/[id]",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const result = await updateCheckIn(user.id, id, parsed.value);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CheckInNotFoundError) {
      return apiError("not_found", "check-in not found", 404);
    }
    if (err instanceof CheckInForbiddenError) {
      return apiError("forbidden", "not your check-in", 403);
    }
    logError({ route: "PATCH /api/checkins/[id]", requestId: getRequestId(request), error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}

/**
 * DELETE /api/checkins/[id]
 * Soft-delete the caller's own check-in (sets deleted_at, recomputes
 * work_stats, hides its photos from the cafe gallery). Requires auth.
 * 404 when missing or already deleted. 403 when not the author.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "id must be a UUID", 400);
  }

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "DELETE /api/checkins/[id]",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const result = await softDeleteCheckIn(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CheckInNotFoundError) {
      return apiError("not_found", "check-in not found", 404);
    }
    if (err instanceof CheckInForbiddenError) {
      return apiError("forbidden", "not your check-in", 403);
    }
    logError({ route: "DELETE /api/checkins/[id]", requestId: getRequestId(request), error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
