import { NextResponse } from "next/server";
import { POIServiceError, resolveMapsUrl } from "@/lib/places/poi-client";

/**
 * POST /api/places/resolve  {maps_share_url}
 * Proxy to the POI cache service resolve — turns a pasted Google Maps link
 * into a POI (cafe creation import path). Short links are followed by the
 * worker; this route just mediates and guards the input.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const mapsShareUrl: unknown =
    body && typeof body === "object" && "maps_share_url" in body
      ? (body as Record<string, unknown>).maps_share_url
      : undefined;
  if (typeof mapsShareUrl !== "string" || mapsShareUrl.trim() === "") {
    return NextResponse.json(
      { error: "invalid_request", message: "maps_share_url (string) required" },
      { status: 400 },
    );
  }

  try {
    const poi = await resolveMapsUrl(mapsShareUrl.trim());
    return NextResponse.json(poi);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return NextResponse.json({ error: "poi_service", message: err.message }, { status: err.status });
    }
    console.error("/api/places/resolve failed", err);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}
