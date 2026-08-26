import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { CafeNotFoundError } from "@/lib/db/checkins";
import { parseNavigationBody, recordNavigation } from "@/lib/db/navigations";
import {
  CAFES_WRITE_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { requireSameOrigin } from "@/lib/security/origin";

/**
 * POST /api/navigations  {cafe_id}
 * Records the "导航" tap that drives the ClassPass-style "did you visit?"
 * prompt on the next visit (spec 0001). Requires auth; 404 when the cafe
 * does not exist.
 */
export async function POST(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const body = await request.json().catch(() => null);
  const parsed = parseNavigationBody(body);
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
    `navigations-write:${clientId}`,
    CAFES_WRITE_RATE_LIMIT.windowMs,
    CAFES_WRITE_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const navigation = await recordNavigation(user.id, parsed.value.cafe_id);
    return NextResponse.json(navigation, { status: 201 });
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return NextResponse.json(
        { error: "not_found", message: "cafe not found" },
        { status: 404 },
      );
    }
    console.error("/api/navigations POST failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
