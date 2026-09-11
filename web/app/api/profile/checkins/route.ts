import { logError } from "@/lib/observability/server-log";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseQueryPositiveInt } from "@/lib/api/response";
import { getUserCheckIns, ProfileCursorError } from "@/lib/db/profile";
import { appConfig } from "@/lib/config";
import { guard } from "@/lib/api/guard";

export async function GET(request: NextRequest) {
  const gate = await guard(request, {
    bucket: "profile-read",
    requireAuth: true,
    route: "GET /api/profile/checkins",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

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
    logError({ route: gate.route, request, error, status: 500 });
    return apiError("internal_error", 500);
  }
}
