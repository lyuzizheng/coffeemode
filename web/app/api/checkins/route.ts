import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  CafeNotFoundError,
  createCheckIn,
  parseCheckInBody,
} from "@/lib/db/checkins";
import {
  CAFES_WRITE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

/**
 * POST /api/checkins  {cafe_id, scores?, min_spend?, max_stay?, note?, photos?, visited_at?}
 * Regular (non-creation) check-in: insert + gallery merge + work_stats
 * fold in one transaction (spec 0001). Requires auth. 404 when the cafe
 * does not exist.
 */
export async function POST(request: Request) {
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
    console.error("/api/checkins POST failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
