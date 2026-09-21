import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { navigationPromptQueue } from "@/lib/db/navigations";

/**
 * GET /api/navigations/prompt
 * Returns the caller's next eligible return-visit prompt (DG78/DG83/DG91):
 * unresolved, earliest the next day, < 3 months old, past the re-ask delay —
 * most recent eligible first. `prompt: null` when the queue is empty.
 * Requires auth; the client fetches lazily after the surface reaches idle
 * (DG77) and shows at most one prompt per session.
 */
export const GET = apiRoute(
  { bucket: "cafes-read", auth: "required", route: "GET /api/navigations/prompt" },
  async (_request, ctx) => {
    const prompt = await navigationPromptQueue.next(ctx.user.id);
    return NextResponse.json({ prompt });
  },
);
