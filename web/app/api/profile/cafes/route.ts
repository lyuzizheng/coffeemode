import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { getUserCafes } from "@/lib/db/profile";
import { appConfig } from "@/lib/config";
import {
  checkRateLimit,
  getClientIdentifier,
  PROFILE_READ_RATE_LIMIT,
  rateLimitResponse,
} from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "profile-read",
    clientId,
    [PROFILE_READ_RATE_LIMIT],
    "GET /api/profile/cafes",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  let limit = appConfig.feed.pageSize;
  if (rawLimit !== null) {
    const parsed = parseInt(rawLimit, 10);
    if (Number.isNaN(parsed) || parsed <= 0 || !Number.isInteger(Number(rawLimit))) {
      return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
    }
    limit = Math.min(50, parsed);
  }

  const cursor = searchParams.get("cursor") ?? undefined;

  try {
    const result = await getUserCafes(user.id, { limit, cursor });
    return NextResponse.json({
      items: result.items,
      next_cursor: result.nextCursor,
    });
  } catch (error) {
    console.error("GET /api/profile/cafes failed:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
