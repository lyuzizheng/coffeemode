import { createPrivateKey, createSign } from "node:crypto";
import { NextResponse } from "next/server";
import {
  PLACES_RATE_LIMIT,
  getClientIdentifier,
  rateLimitResponse,
  rateLimiter,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * GET /api/mapkit-token
 *
 * MapKit JS needs a short-lived browser token, while the Apple private key
 * must remain server-side. Returning 503 when the owner credentials are not
 * configured keeps the Apple search tab honest during local development.
 */
export async function GET(request: Request) {
  const clientId = getClientIdentifier(request, null);
  const limit = await rateLimiter.check(
    `mapkit:${clientId}`,
    PLACES_RATE_LIMIT.windowMs,
    PLACES_RATE_LIMIT.maxRequests,
  );
  if (!limit.allowed) return rateLimitResponse(limit);

  const teamId = process.env.APPLE_MAPKIT_TEAM_ID;
  const keyId = process.env.APPLE_MAPKIT_KEY_ID;
  const privateKey = process.env.APPLE_MAPKIT_PRIVATE_KEY;
  const configuredOrigin = process.env.APPLE_MAPKIT_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
  if (!teamId || !keyId || !privateKey || !configuredOrigin) {
    return NextResponse.json({ error: "mapkit_not_configured" }, { status: 503 });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  let origin: string;
  try {
    origin = new URL(configuredOrigin).origin;
  } catch {
    return NextResponse.json({ error: "mapkit_not_configured" }, { status: 503 });
  }
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: teamId,
      iat: issuedAt,
      exp: issuedAt + 15 * 60,
      scope: "mapkit_js",
      origin,
    }),
  );
  const unsigned = `${header}.${payload}`;

  try {
    const signer = createSign("SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = signer
      .sign({
        key: createPrivateKey(privateKey.replace(/\\n/g, "\n")),
        dsaEncoding: "ieee-p1363",
      })
      .toString("base64url");
    return NextResponse.json({ token: `${unsigned}.${signature}` });
  } catch (err) {
    console.error("/api/mapkit-token failed to sign token", err);
    return NextResponse.json({ error: "mapkit_token_error" }, { status: 500 });
  }
}
