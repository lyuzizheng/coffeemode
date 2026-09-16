import { logError } from "@/lib/observability/server-log";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/response";
import { generateMapKitToken, getMapKitConfig, type MapKitConfig } from "@/lib/places/mapkit";
import { guard } from "@/lib/api/guard";

/**
 * Module-level token memo: MapKit JS tokens are valid for 15 minutes
 * (`web/lib/places/mapkit.ts`), so re-signing on every mount is pure
 * overhead. The cached token is reused until it enters the 60s expiry
 * skew window, and is keyed on the full config so credential rotation
 * (or env changes between tests) immediately re-signs.
 */
const MEMO_REFRESH_SKEW_SECONDS = 60;
let memo: { token: string; exp: number; fingerprint: string } | null = null;

/** `exp` is read back out of the minted JWT so the TTL lives in exactly one place. */
function readTokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function memoizedToken(config: MapKitConfig): string {
  const fingerprint = [config.teamId, config.keyId, config.privateKey, config.origin].join("\0");
  const nowSec = Math.floor(Date.now() / 1000);
  if (memo && memo.fingerprint === fingerprint && memo.exp - nowSec >= MEMO_REFRESH_SKEW_SECONDS) {
    return memo.token;
  }
  const token = generateMapKitToken(config);
  memo = { token, exp: readTokenExp(token) ?? nowSec, fingerprint };
  return token;
}
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
    const token = memoizedToken(config);
    return NextResponse.json({ token });
  } catch (err) {
    logError({ route: gate.route, request, error: err, status: 500 });
    return apiError("mapkit_token_error", 500);
  }
}
