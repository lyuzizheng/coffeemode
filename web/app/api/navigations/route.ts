import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { parseNavigationBody, recordNavigation } from "@/lib/db/navigations";
import { readJsonBody } from "@/lib/api/guard";

/**
 * POST /api/navigations  {cafe_id}
 * Records the "导航" tap that drives the ClassPass-style "did you visit?"
 * prompt on the next visit (spec 0001). Requires auth; 404 when the cafe
 * does not exist.
 */
export const POST = apiRoute(
  { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/navigations" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseNavigationBody(bodyRes.data);
    if (!parsed.ok) {
      return apiError("invalid_request", parsed.message, { status: 400, requestId: ctx.requestId });
    }

    const navigation = await recordNavigation(ctx.user.id, parsed.value.cafe_id);
    return NextResponse.json(navigation, { status: 201 });
  },
);
