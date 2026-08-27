import "server-only";

import { createPrivateKey, createSign } from "node:crypto";

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export interface MapKitConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  origin: string;
}

/** Read MapKit credentials from environment. Returns null if not configured. */
export function getMapKitConfig(): MapKitConfig | null {
  const teamId = process.env.APPLE_MAPKIT_TEAM_ID;
  const keyId = process.env.APPLE_MAPKIT_KEY_ID;
  const privateKey = process.env.APPLE_MAPKIT_PRIVATE_KEY;
  const configuredOrigin = process.env.APPLE_MAPKIT_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
  if (!teamId || !keyId || !privateKey || !configuredOrigin) {
    return null;
  }
  try {
    const origin = new URL(configuredOrigin).origin;
    return { teamId, keyId, privateKey, origin };
  } catch {
    return null;
  }
}

/** Generate a short-lived ES256 MapKit JS client token (spec 0001). */
export function generateMapKitToken(config: MapKitConfig): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: config.teamId,
      iat: issuedAt,
      exp: issuedAt + 15 * 60,
      scope: "mapkit_js",
      origin: config.origin,
    }),
  );
  const unsigned = `${header}.${payload}`;

  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign({
      key: createPrivateKey(config.privateKey.replace(/\\n/g, "\n")),
      dsaEncoding: "ieee-p1363",
    })
    .toString("base64url");

  return `${unsigned}.${signature}`;
}
