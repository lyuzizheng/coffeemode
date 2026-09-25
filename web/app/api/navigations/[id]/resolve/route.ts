import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { navigationPromptQueue } from "@/lib/db/navigations";
import { parsePromptAnswerBody } from "@/lib/validation/navigation";
import { readJsonBody } from "@/lib/api/guard";
import { isValidUUID } from "@shared/uuid";

/**
 * POST /api/navigations/[id]/resolve  {outcome: "visited" | "wont_go" | "not_yet"}
 * Records the user's answer to the return-visit prompt (DG80/DG91):
 * "visited"/"wont_go" resolve permanently; "not_yet" stamps the ≥1-day
 * re-ask delay and auto-resolves past the re-ask cap. Answers apply to the
 * whole stack of that user's unresolved navigations to the same cafe, not
 * just the shown row (BRAWUKA-270). Idempotent — a repeat answer on an
 * already-resolved row returns the stored outcome, and a completed
 * check-in's `auto` resolution is never overwritten.
 * Requires auth; 404 when the navigation does not belong to the caller.
 */
export const POST = apiRoute<{ id: string }>(
  { bucket: "cafes-write", auth: "required", origin: true, route: "POST /api/navigations/[id]/resolve" },
  async (request, ctx) => {
    const { id } = ctx.params;
    if (!isValidUUID(id)) {
      return apiError("invalid_request", "navigation id must be a UUID", { status: 400, requestId: ctx.requestId });
    }

    const bodyRes = await readJsonBody(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const parsed = parsePromptAnswerBody(bodyRes.data);
    if (!parsed.ok) {
      return apiError("invalid_request", parsed.message, { status: 400, requestId: ctx.requestId });
    }

    const result = await navigationPromptQueue.answer(ctx.user.id, id, parsed.value.outcome);
    if (result.status === "gone") {
      return apiError("not_found", "navigation not found", { status: 404, requestId: ctx.requestId });
    }
    return NextResponse.json({ outcome: result.outcome });
  },
);
