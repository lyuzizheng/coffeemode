import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { apiRoute } from "@/lib/api/route";
import { storeExternalPOIs } from "@/lib/places/poi-client";
import { MAX_EXTERNAL_BATCH_SIZE } from "@shared/places/constants";
import type { POI } from "@shared/places/types";
import { readJsonBody } from "@/lib/api/guard";

/**
 * POST /api/places/external
 *
 * Store a POI returned by a browser-side provider search. Apple MapKit has no
 * server-side Places API, so this is the persistence boundary for its result
 * before the cafe creation request uses the Apple reference.
 */
export const POST = apiRoute(
  { bucket: "places", auth: "required", origin: true, route: "POST /api/places/external" },
  async (request, ctx) => {
    const bodyRes = await readJsonBody<{ pois?: unknown }>(request, { requestId: ctx.requestId });
    if (!bodyRes.ok) return bodyRes.response;
    const body = bodyRes.data;
    const pois =
      body && typeof body === "object" && "pois" in body
        ? (body as Record<string, unknown>).pois
        : undefined;
    if (!Array.isArray(pois) || pois.length === 0) {
      return apiError("invalid_request", "pois array required", { status: 400, requestId: ctx.requestId });
    }
    if (pois.length > MAX_EXTERNAL_BATCH_SIZE) {
      return apiError("invalid_request", `pois array must contain at most ${MAX_EXTERNAL_BATCH_SIZE} items`, { status: 400, requestId: ctx.requestId });
    }
    if (
      !pois.every(
        (poi) =>
          poi !== null &&
          typeof poi === "object" &&
          (poi as Record<string, unknown>).source === "apple",
      )
    ) {
      return apiError("invalid_request", 400, { requestId: ctx.requestId });
    }

    const result = await storeExternalPOIs(pois as POI[]);
    return NextResponse.json(result);
  },
);
