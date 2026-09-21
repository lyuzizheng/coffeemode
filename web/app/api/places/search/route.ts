import { NextResponse } from "next/server";
import { apiError, parseQueryNumberOrNaN } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM } from "@/lib/places/constants";
import { searchExternalPOIs, searchPOIs } from "@/lib/places/poi-client";

/**
 * GET /api/places/search?q&lat&lng&r
 * Proxy to the POI cache service search. `source=google` selects live Google
 * Places search; the default searches the reusable stored-POI cache. Apple
 * MapKit search runs in the browser and stores its selected result through
 * POST /api/places/external.
 *
 * The radius parameter is clamped to MAX_SEARCH_RADIUS_KM to prevent abuse.
 */
export const GET = apiRoute(
  {
    bucket: "places",
    // Live Google search bills per request; only the signed-in creation flow
    // may trigger it. Stored-cache search stays public.
    auth: (request) => new URL(request.url).searchParams.get("source") === "google",
    route: "GET /api/places/search",
  },
  async (request, ctx) => {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    const source = searchParams.get("source") ?? "stored";
    const lat = parseQueryNumberOrNaN(searchParams.get("lat"));
    const lng = parseQueryNumberOrNaN(searchParams.get("lng"));
    const rRaw = searchParams.get("r");
    const r = rRaw ? parseQueryNumberOrNaN(rRaw) : DEFAULT_SEARCH_RADIUS_KM;

    const latProvided = searchParams.has("lat");
    const lngProvided = searchParams.has("lng");
    const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);
    if ((latProvided || lngProvided) && !hasCoords) {
      return apiError("invalid_request", "lat/lng must both be numbers", { status: 400, requestId: ctx.requestId });
    }
    if (hasCoords && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
      return apiError("invalid_request", "lat must be [-90, 90] and lng [-180, 180]", { status: 400, requestId: ctx.requestId });
    }
    if (q === "" && !hasCoords) {
      return apiError("invalid_request", "q or lat+lng required", { status: 400, requestId: ctx.requestId });
    }
    if (Number.isNaN(r) || r <= 0) {
      return apiError("invalid_request", "r must be a positive number (km)", { status: 400, requestId: ctx.requestId });
    }
    if (source !== "stored" && source !== "google") {
      return apiError("invalid_request", "source must be stored or google", { status: 400, requestId: ctx.requestId });
    }
    if (source === "google" && q === "") {
      return apiError("invalid_request", "q is required for Google search", { status: 400, requestId: ctx.requestId });
    }

    const clampedR = Math.min(r, MAX_SEARCH_RADIUS_KM);

    const data =
      source === "google"
        ? await searchExternalPOIs(
            {
              q,
              lat: hasCoords ? lat : undefined,
              lng: hasCoords ? lng : undefined,
              r: clampedR,
            },
            ctx.requestId,
          )
        : await searchPOIs(
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
