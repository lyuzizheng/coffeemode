import { NextResponse } from "next/server";
import { POIServiceError, searchPOIs } from "@/lib/places/poi-client";

/**
 * GET /api/places/search?q&lat&lng&r
 * Proxy to the POI cache service search (stored POIs, haversine distance sort).
 * This is what the discovery sheet's external/reset search will call.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const lat = Number.parseFloat(searchParams.get("lat") ?? "");
  const lng = Number.parseFloat(searchParams.get("lng") ?? "");
  const rRaw = searchParams.get("r");
  const r = rRaw ? Number.parseFloat(rRaw) : 50;

  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng);
  if (q === "" && !hasCoords) {
    return NextResponse.json(
      { error: "invalid_request", message: "q or lat+lng required" },
      { status: 400 },
    );
  }
  if (Number.isNaN(r) || r <= 0) {
    return NextResponse.json(
      { error: "invalid_request", message: "r must be a positive number (km)" },
      { status: 400 },
    );
  }

  try {
    const data = await searchPOIs({
      q: q || undefined,
      lat: hasCoords ? lat : undefined,
      lng: hasCoords ? lng : undefined,
      r,
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof POIServiceError) {
      return NextResponse.json({ error: "poi_service", message: err.message }, { status: err.status });
    }
    console.error("/api/places/search failed", err);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}