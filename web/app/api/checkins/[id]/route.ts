import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { softDeleteCheckIn, updateCheckIn } from "@/lib/db/checkins";
import { parseUpdateCheckInBody } from "@/lib/validation/checkin";
import { readJsonBody } from "@/lib/api/guard";
import { isValidUUID } from "@shared/uuid";

/**
 * PATCH /api/checkins/[id]
 * Edit the caller's own check-in (scores, policies, note, visited_at).
 * Requires auth. 404 when missing or soft-deleted. 403 when not the author.
 * 400 when the body is invalid. Photos are not edited via this endpoint
 * (creation-time photos are fixed; use a new check-in for new photos).
 */
export const PATCH = apiRoute<{ id: string }>(
  { bucket: "cafes-write", auth: "required", origin: true, route: "PATCH /api/checkins/[id]" },
  async (request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parseUpdateCheckInBody(bodyRes.data);
    if (!parsed.ok) {
      return apiError("invalid_request", parsed.message, { status: 400, requestId: ctx.requestId });
    }

    const result = await updateCheckIn(ctx.user.id, id, parsed.value);
    return NextResponse.json(result);
  },
);

/**
 * DELETE /api/checkins/[id]
 * Soft-delete the caller's own check-in (sets deleted_at, recomputes
 * work_stats, hides its photos from the cafe gallery). Requires auth.
 * 404 when missing or already deleted. 403 when not the author.
 */
export const DELETE = apiRoute<{ id: string }>(
  { bucket: "cafes-write", auth: "required", origin: true, route: "DELETE /api/checkins/[id]" },
  async (_request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const result = await softDeleteCheckIn(ctx.user.id, id);
    return NextResponse.json(result);
  },
);
