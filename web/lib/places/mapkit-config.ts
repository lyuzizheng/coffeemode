/**
 * MapKit credential detection — edge-safe (no `node:` imports, no
 * `server-only`) so `next.config.ts` can derive the build-time
 * `NEXT_PUBLIC_MAPKIT_CONFIGURED` flag from the same predicate the
 * `/api/mapkit-token` route uses. Token signing stays in `mapkit.ts`.
 */
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
    // Benign: malformed origin URL treats MapKit as unconfigured.
    return null;
  }
}
