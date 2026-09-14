import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { navigationPromptQueue } from "@/lib/db/navigations";
import { guard } from "@/lib/api/guard";

/**
 * GET /api/navigations/prompt
 * Returns the caller's next eligible return-visit prompt (DG78/DG83/DG91):
 * unresolved, earliest the next day, < 3 months old, past the re-ask delay —
 * most recent eligible first. `prompt: null` when the queue is empty.
 * Requires auth; the client fetches lazily after the surface reaches idle
 * (DG77) and shows at most one prompt per session.
 */
export async function GET(request: Request) {
  const gate = await guard(request, {
    bucket: "cafes-read",
    requireAuth: true,
    route: "GET /api/navigations/prompt",
  });
  if (!gate.ok) return gate.response;
  const { user } = gate;

  try {
    const prompt = await navigationPromptQueue.next(user.id);
    return NextResponse.json({ prompt });
  } catch (err) {
    logError({ route: gate.route, request, error: err, status: 500 });
    return apiError("internal_error", 500);
  }
}
