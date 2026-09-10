import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { generateMapKitToken, getMapKitConfig } from "@/lib/places/mapkit";
import { guard } from "@/lib/api/guard";

export const runtime = "nodejs";

/**
 * GET /api/mapkit-token
 *
 * MapKit JS needs a short-lived browser token, while the Apple private key
 * must remain server-side. Returning 503 when the owner credentials are not
 * configured keeps the Apple search tab honest during local development.
 */
export async function GET(request: Request) {
  const gate = await guard(request, {
    bucket: "places",
    route: "GET /api/mapkit-token",
    ipOnly: true,
  });
  if (!gate.ok) return gate.response;

  const config = getMapKitConfig();
  if (!config) {
    return apiError("mapkit_not_configured", 503);
  }

  try {
    const token = generateMapKitToken(config);
    return NextResponse.json({ token });
  } catch (err) {
    console.error("/api/mapkit-token failed to sign token", err);
    return apiError("mapkit_token_error", 500);
  }
}
