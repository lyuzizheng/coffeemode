import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { navigationPromptQueue } from "@/lib/db/navigations";

/**
 * GET /api/navigations/prompt
 * Returns the caller's next eligible return-visit prompt (DG78/DG83/DG91):
 * unresolved, earliest the next day, < 3 months old, past the re-ask delay —
 * most recent eligible first. `prompt: null` when the queue is empty.
 *
 * Optional auth (BRAWUKA-818): the cafe-detail map app asks every visitor,
 * and a guest has no queue to read — `{ prompt: null }` is the answer, not a
 * 401 that surfaces as a console network error on a page that works. A guest
 * consult never touches Postgres, so the anonymous cost is the guard alone.
 * DG76's anonymous *sessions* (Supabase anonymous sign-in) still arrive with
 * a user id and read their real queue.
 *
 * The client fetches lazily after the surface reaches idle (DG77) and shows
 * at most one prompt per session.
 */
export const GET = apiRoute(
  { bucket: "cafes-read", auth: "optional", route: "GET /api/navigations/prompt" },
  async (_request, ctx) => {
    const prompt = ctx.user ? await navigationPromptQueue.next(ctx.user.id) : null;
    return NextResponse.json({ prompt });
  },
);
