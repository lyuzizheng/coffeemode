import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import { apiError, parseQueryPositiveInt } from "@/lib/api/response";
import { getUserCheckIns, ProfileCursorError } from "@/lib/db/profile";
import { appConfig, rateLimitBuckets } from "@/lib/config";
import {
  checkRateLimit,
  getClientIdentifier,
  rateLimitResponse,
} from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return apiError("unauthorized", 401);
  }

  const clientId = getClientIdentifier(request, user);
  const rate = await checkRateLimit(
    "profile-read",
    clientId,
    rateLimitBuckets("profile-read"),
    "GET /api/profile/checkins",
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  const limit = parseQueryPositiveInt(
    rawLimit,
    appConfig.profile.listPageSize,
    appConfig.profile.listLimitMax,
  );
  if (limit === null) {
    return apiError("invalid_limit", 400);
  }
  const cursor = searchParams.get("cursor") ?? undefined;

  try {
    const result = await getUserCheckIns(user.id, { limit, cursor });
    return NextResponse.json({
      items: result.items,
      next_cursor: result.nextCursor,
    });
  } catch (error) {
    if (error instanceof ProfileCursorError) {
      return apiError("invalid_cursor", 400);
    }
    console.error("GET /api/profile/checkins failed:", error);
    return apiError("internal_error", 500);
  }
}
