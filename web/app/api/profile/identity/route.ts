import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { readJsonBody } from "@/lib/api/guard";
import { updateProfileIdentity } from "@/lib/db/identity";

export const PATCH = apiRoute(
  { bucket: "identity-write", auth: "required", origin: true, route: "PATCH /api/profile/identity" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const body = bodyRes.data;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return apiError("invalid_request", "invalid JSON body", { status: 400, requestId: ctx.requestId });
    }

    const raw = body as { showPublicIdentity?: unknown; publicHandle?: unknown };

    if (typeof raw.showPublicIdentity !== "boolean") {
      return apiError("invalid_request", "showPublicIdentity (boolean) required", { status: 400, requestId: ctx.requestId });
    }

    if (raw.publicHandle !== undefined && typeof raw.publicHandle !== "string") {
      return apiError("invalid_request", "publicHandle must be a string", { status: 400, requestId: ctx.requestId });
    }

    const result = await updateProfileIdentity(ctx.user.id, {
      showPublicIdentity: raw.showPublicIdentity,
      publicHandle: raw.publicHandle as string | undefined,
    });

    return NextResponse.json({
      ok: true,
      ...result,
    });
  },
);
