import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError } from "@/lib/api/response";
import { CafeNotFoundError } from "@/lib/db/checkins";
import { parseNavigationBody, recordNavigation } from "@/lib/db/navigations";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { rateLimitBuckets } from "@/lib/config";
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
    "POST /api/navigations",
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const navigation = await recordNavigation(user.id, parsed.value.cafe_id);
    return NextResponse.json(navigation, { status: 201 });
  } catch (err) {
    if (err instanceof CafeNotFoundError) {
      return apiError("not_found", "cafe not found", 404);
    }
    console.error("/api/navigations POST failed", err);
    return apiError("internal_error", 500);
  }
}
