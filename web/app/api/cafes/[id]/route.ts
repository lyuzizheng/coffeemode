import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import {
  cafeExists,
  deleteCafe,
  getCafe,
  toPublicCafeDetail,
} from "@/lib/db/cafes";
import { readJsonBody } from "@/lib/api/guard";
import { isValidUUID } from "@shared/uuid";

/**
 * GET /api/cafes/[id]
 * Single cafe detail. Anonymous read, rate limited; 404 when missing.
 */
export const GET = apiRoute<{ id: string }>(
  { bucket: "cafes-read", route: "GET /api/cafes/[id]" },
  async (request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const cafe = await getCafe(id, ctx.user?.id);
    if (!cafe) {
      return apiError("not_found", "cafe not found", { status: 404, requestId: ctx.requestId });
    }
    return NextResponse.json(toPublicCafeDetail(cafe, ctx.user?.id));
  },
);

/**
 * DELETE /api/cafes/[id]
 * Checkin-scoped cafe delete (DG125 / issue #229). Auth required; only creator can delete.
 */
export const DELETE = apiRoute<{ id: string }>(
  { bucket: "cafes-write", auth: "required", origin: true, route: "DELETE /api/cafes/[id]" },
  async (request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const exists = await cafeExists(id, ctx.user.id);
    if (!exists) {
      return apiError("not_found", "cafe not found", { status: 404, requestId: ctx.requestId });
    }

    const bodyRes = await readJsonBody<{ confirm?: unknown }>(request, {
      optional: true,
      requestId: ctx.requestId,
    });
    if (!bodyRes.ok) return bodyRes.response;
    const body = bodyRes.data;
    const confirm =
      typeof body === "object" && body !== null && body.confirm === true;

    const result = await deleteCafe(id, ctx.user.id, { confirm });
    return NextResponse.json(result);
  },
);
