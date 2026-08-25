import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  CheckInForbiddenError,
  CheckInNotFoundError,
  parseUpdateCheckInBody,
  softDeleteCheckIn,
  updateCheckIn,
} from "@/lib/db/checkins";
import {
  CAFES_WRITE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { isValidUUID } from "@shared/uuid";
import { isSameOrigin } from "@/lib/security/origin";

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
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = parseUpdateCheckInBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid_request", message: parsed.message },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `checkins-write:${clientId}`,
    CAFES_WRITE_RATE_LIMIT.windowMs,
    CAFES_WRITE_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const result = await updateCheckIn(user.id, id, parsed.value);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CheckInNotFoundError) {
      return NextResponse.json(
        { error: "not_found", message: "check-in not found" },
        { status: 404 },
      );
    }
    if (err instanceof CheckInForbiddenError) {
      return NextResponse.json(
        { error: "forbidden", message: "not your check-in" },
        { status: 403 },
      );
    }
    console.error("/api/checkins/[id] PATCH failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
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
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `checkins-write:${clientId}`,
    CAFES_WRITE_RATE_LIMIT.windowMs,
    CAFES_WRITE_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const result = await softDeleteCheckIn(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CheckInNotFoundError) {
      return NextResponse.json(
        { error: "not_found", message: "check-in not found" },
        { status: 404 },
      );
    }
    if (err instanceof CheckInForbiddenError) {
      return NextResponse.json(
        { error: "forbidden", message: "not your check-in" },
        { status: 403 },
      );
    }
    console.error("/api/checkins/[id] DELETE failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
