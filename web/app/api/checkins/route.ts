import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  CafeNotFoundError,
  createCheckIn,
  parseCheckInBody,
} from "@/lib/db/checkins";
import { PhotoIntentError } from "@/lib/images/provision-photos";
import { ImageServiceError } from "@/lib/images/image-service-client";
import {
  CAFES_WRITE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/checkins  {cafe_id, scores?, min_spend?, max_stay?, note?, photo_ids?, visited_at?}
 * Regular (non-creation) check-in: insert + gallery merge + work_stats
 * fold in one transaction (spec 0001). Requires auth. 404 when the cafe
 * does not exist. Photos are image UUIDs from /api/images/upload; the
 * server provisions and derives them (issue #86) — 400 invalid_photos
 * when an id was not issued to the caller or was already consumed.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseCheckInBody(body);
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
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const result = await createCheckIn(user.id, parsed.value);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return NextResponse.json(
        { error: "not_found", message: "cafe not found" },
        { status: 404 },
      );
    }
    if (
      err instanceof PhotoIntentError ||
      // The caller's own upload never landed in R2 (worker 404) — same
      // user-facing class as a bad photo id, not a server fault.
      (err instanceof ImageServiceError && err.status === 404)
    ) {
      return NextResponse.json(
        { error: "invalid_photos", message: "one or more photos are invalid" },
        { status: 400 },
      );
    }
    console.error("/api/checkins POST failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
