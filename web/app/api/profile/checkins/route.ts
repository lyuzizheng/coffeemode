import { NextResponse } from "next/server";
import { apiError, parseQueryPositiveInt } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { getUserCheckIns } from "@/lib/db/profile";
import { appConfig } from "@/lib/config";

export const GET = apiRoute(
  { bucket: "profile-read", auth: "required", route: "GET /api/profile/checkins" },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get("limit");
    const limit = parseQueryPositiveInt(
      rawLimit,
      appConfig.profile.listPageSize,
      appConfig.profile.listLimitMax,
    );
    if (limit === null) {
      return apiError("invalid_limit", 400, { requestId: ctx.requestId });
    }
    const cursor = searchParams.get("cursor") ?? undefined;

    const result = await getUserCheckIns(ctx.user.id, { limit, cursor });
    return NextResponse.json({
      items: result.items,
      next_cursor: result.next_cursor,
    });
  },
);
