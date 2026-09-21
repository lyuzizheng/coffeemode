import { NextResponse } from "next/server";
import { apiError, parseQueryNumberOrNaN } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM } from "@/lib/places/constants";
import { searchPOIs } from "@/lib/places/poi-client";

/**
 * GET /api/places/search?q&lat&lng&r
 * Proxy to the POI cache service search: name match + haversine distance sort
 * over the reusable stored-POI cache.
 *
 * Live Google search is NOT here (BRAWUKA-602). It is a two-phase flow —
 * `GET /api/places/autocomplete` while typing, `GET /api/places/details` on
 * selection — because Text Search billed every keystroke at the Enterprise
 * tier. Apple MapKit search still runs in the browser and stores its selected
 * result through POST /api/places/external.
 *
 * The radius parameter is clamped to MAX_SEARCH_RADIUS_KM to prevent abuse.
 */
export const GET = apiRoute(
  {
    bucket: "places",
    route: "GET /api/places/search",
  },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
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
    if (q === "" && !hasCoords) {
      return apiError("invalid_request", "q or lat+lng required", {
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

    const data = await searchPOIs(
      {
        q: q || undefined,
        lat: hasCoords ? lat : undefined,
        lng: hasCoords ? lng : undefined,
        r: clampedR,
      },
      ctx.requestId,
    );

    return NextResponse.json(data);
  },
);
