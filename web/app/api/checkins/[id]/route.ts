import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import {
  CheckInForbiddenError,
  CheckInNotFoundError,
  parseUpdateCheckInBody,
  softDeleteCheckIn,
  updateCheckIn,
} from "@/lib/db/checkins";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
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

  const body = await request.json().catch(() => null);
  const parsed = parseUpdateCheckInBody(body);
  if (!parsed.ok) {
    return apiError("invalid_request", parsed.message, 400);
  }

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-write",
    clientId,
    rateLimitBuckets("cafes-write"),
    "PATCH /api/checkins/[id]",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

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
    console.error("/api/checkins/[id] PATCH failed", err);
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

  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "cafes-write",
    clientId,
    rateLimitBuckets("cafes-write"),
    "DELETE /api/checkins/[id]",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

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
    console.error("/api/checkins/[id] DELETE failed", err);
    return apiError("internal_error", 500);
  }
}
