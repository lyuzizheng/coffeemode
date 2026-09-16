import "server-only";

import { createPrivateKey, createSign } from "node:crypto";
import type { MapKitConfig } from "./mapkit-config";

// Credential detection lives in `mapkit-config.ts` (edge-safe) so
// `next.config.ts` derives NEXT_PUBLIC_MAPKIT_CONFIGURED from the same
// predicate this route's 503 gate uses — one readiness signal (BRAWUKA-326).
export { getMapKitConfig } from "./mapkit-config";
export type { MapKitConfig } from "./mapkit-config";

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
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
