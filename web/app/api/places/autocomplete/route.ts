import { NextResponse } from "next/server";
import { apiError, parseQueryNumberOrNaN } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM } from "@/lib/places/constants";
import { autocompletePOIs } from "@/lib/places/poi-client";

/**
 * GET /api/places/autocomplete?q&lat&lng&r&session
 *
 * The typing phase of the two-phase POI search (BRAWUKA-602). Proxies to the
 * worker's Autocomplete (New) call, which Google folds into the $0
 * `Autocomplete Session Usage` SKU as long as the session is terminated by a
 * Place Details request carrying the same token — that is what
 * `GET /api/places/details` does on selection.
 *
 * `session` is required and must be a UUID: Google silently ignores a
 * malformed token, which would quietly revert the whole session to
 * per-request billing. Rejecting it here keeps that failure loud.
 *
 * Signed-in only. Autocomplete requests bill at $0 once their session is
 * terminated, but they are still a live upstream call per keystroke, so this
 * stays behind the same auth gate the previous live search had.
 */
const SESSION_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = apiRoute(
  {
    bucket: "places-autocomplete",
    auth: "required",
    route: "GET /api/places/autocomplete",
  },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const session = searchParams.get("session")?.trim() ?? "";
    const lat = parseQueryNumberOrNaN(searchParams.get("lat"));
    const lng = parseQueryNumberOrNaN(searchParams.get("lng"));
    const rRaw = searchParams.get("r");
    const r = rRaw ? parseQueryNumberOrNaN(rRaw) : DEFAULT_SEARCH_RADIUS_KM;

    const latProvided = searchParams.has("lat");
    const lngProvided = searchParams.has("lng");
    const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);
    if ((latProvided || lngProvided) && !hasCoords) {
      return apiError("invalid_request", "lat/lng must both be numbers", {
        status: 400,
        requestId: ctx.requestId,
      });
    }
    if (hasCoords && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
      return apiError("invalid_request", "lat must be [-90, 90] and lng [-180, 180]", {
        status: 400,
        requestId: ctx.requestId,
      });
    }
    if (q === "") {
      return apiError("invalid_request", "q is required", {
        status: 400,
        requestId: ctx.requestId,
      });
    }
    if (!SESSION_TOKEN_RE.test(session)) {
      return apiError("invalid_request", "session must be a UUID (Autocomplete session token)", {
        status: 400,
        requestId: ctx.requestId,
      });
    }
    if (Number.isNaN(r) || r <= 0) {
      return apiError("invalid_request", "r must be a positive number (km)", {
        status: 400,
        requestId: ctx.requestId,
      });
    }

    const clampedR = Math.min(r, MAX_SEARCH_RADIUS_KM);

    const data = await autocompletePOIs(
      {
        q,
        session,
        lat: hasCoords ? lat : undefined,
        lng: hasCoords ? lng : undefined,
        r: clampedR,
      },
      ctx.requestId,
    );
    return NextResponse.json(data);
  },
);
