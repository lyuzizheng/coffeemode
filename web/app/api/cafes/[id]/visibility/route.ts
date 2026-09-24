import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { cafeExists, setCafeVisibility } from "@/lib/db/cafes";
import { readJsonBody } from "@/lib/api/guard";
import { isValidUUID } from "@shared/uuid";
import type { CafeVisibility } from "@/types/cafes";

/**
 * PATCH /api/cafes/[id]/visibility
 * Body: { visibility: "public" | "private" }
 * Toggles cafe visibility between 'public' and 'private' (DG147 / issue #229).
 * Reversible, creator-only toggle. Idempotent.
 */
export const PATCH = apiRoute<{ id: string }>(
  { bucket: "cafes-write", auth: "required", origin: true, route: "PATCH /api/cafes/[id]/visibility" },
  async (request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const bodyRes = await readJsonBody<Record<string, unknown>>(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const body = bodyRes.data;
    const rawVisibility =
      typeof body === "object" && body !== null && "visibility" in body
        ? body.visibility
        : undefined;
    if (rawVisibility !== "public" && rawVisibility !== "private") {
      return apiError("invalid_request", "visibility must be 'public' or 'private'", { status: 400, requestId: ctx.requestId });
    }
    const visibility = rawVisibility as CafeVisibility;

    // cafeExists applies the visibility filter: a non-owner probing a private
    // cafe gets the same 404 as a nonexistent id (BRAWUKA-435).
    const exists = await cafeExists(id, ctx.user.id);
    if (!exists) {
      return apiError("not_found", "cafe not found", { status: 404, requestId: ctx.requestId });
    }

    const result = await setCafeVisibility(id, ctx.user.id, visibility);
    return NextResponse.json(result);
  },
);
