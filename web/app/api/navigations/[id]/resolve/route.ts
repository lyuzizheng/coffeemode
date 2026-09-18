import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { navigationPromptQueue, parsePromptAnswerBody } from "@/lib/db/navigations";
import { guard, readJsonBody } from "@/lib/api/guard";
import { requireSameOrigin } from "@/lib/security/origin";
import { isValidUUID } from "@shared/uuid";

/**
 * POST /api/navigations/[id]/resolve  {outcome: "visited" | "wont_go" | "not_yet"}
 * Records the user's answer to the return-visit prompt (DG80/DG91):
 * "visited"/"wont_go" resolve permanently; "not_yet" stamps the ≥1-day
 * re-ask delay and auto-resolves past the re-ask cap. Idempotent — a repeat
 * answer on an already-resolved row returns the stored outcome, and a
 * completed check-in's `auto` resolution is never overwritten.
 * Requires auth; 404 when the navigation does not belong to the caller.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return apiError("invalid_request", "navigation id must be a UUID", { status: 400 });
  }

  const bodyRes = await readJsonBody(request);
  if (!bodyRes.ok) return bodyRes.response;
  const parsed = parsePromptAnswerBody(bodyRes.data);
  if (!parsed.ok) {
    return apiError("invalid_request", parsed.message, { status: 400 });
  }

  const gate = await guard(request, {
    bucket: "cafes-write",
    requireAuth: true,
    route: "POST /api/navigations/[id]/resolve",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const result = await navigationPromptQueue.answer(user.id, id, parsed.value.outcome);
    if (result.status === "gone") {
      return apiError("not_found", "navigation not found", { status: 404 });
    }
    return NextResponse.json({ outcome: result.outcome });
  } catch (err) {
    logError({ route: gate.route, request, error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
