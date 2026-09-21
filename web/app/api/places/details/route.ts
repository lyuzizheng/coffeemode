import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { getPOI } from "@/lib/places/poi-client";

/**
 * GET /api/places/details?place_id&session
 *
 * The selection phase of the two-phase POI search (BRAWUKA-602): resolves one
 * Autocomplete prediction into a full POI. This is the only billed Google
 * call in the flow, and passing `session` terminates the Autocomplete session
 * that produced the id — without it every keystroke in that session would be
 * billed per request instead of at $0.
 *
 * A missing or malformed `session` is dropped rather than rejected, matching
 * the worker (`GET /poi/:place_id`): the lookup is valid either way, it just
 * loses the session discount. Only `place_id` is required.
 *
 * Signed-in only: it spends money.
 */
const SESSION_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = apiRoute(
  {
    bucket: "places",
    auth: "required",
    route: "GET /api/places/details",
  },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get("place_id")?.trim() ?? "";
    const session = searchParams.get("session")?.trim() ?? "";

    if (placeId === "") {
      return apiError("invalid_request", "place_id is required", {
        status: 400,
        requestId: ctx.requestId,
      });
    }

    const poi = await getPOI(
      placeId,
      SESSION_TOKEN_RE.test(session) ? session : undefined,
      ctx.requestId,
    );
    return NextResponse.json(poi);
  },
);
