import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getCafe, toPublicCafeDetail } from "@/lib/db/cafes";
import {
  CAFES_READ_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";
import { isValidUUID } from "@shared/uuid";

/**
 * GET /api/cafes/[id]
 * Single cafe detail. Anonymous read, rate limited; 404 when missing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json(
      { error: "invalid_request", message: "id must be a UUID" },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  const clientId = getClientIdentifier(request, user);
  const rate = await rateLimiter.check(
    `cafes-read:${clientId}`,
    CAFES_READ_RATE_LIMIT.windowMs,
    CAFES_READ_RATE_LIMIT.maxRequests,
  );
  if (!rate.allowed) {
    return rateLimitResponse(rate);
  }

  try {
    const cafe = await getCafe(id);
    if (!cafe) {
      return NextResponse.json(
        { error: "not_found", message: "cafe not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(toPublicCafeDetail(cafe));
  } catch (err) {
    console.error("/api/cafes/[id] GET failed", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
