/**
 * Stable Apple place-id fallback — the single source of truth shared by the
 * web app (browser MapKit search) and the POI worker (share-URL resolve).
 *
 * FNV-1a over "lat,lng:label". 32-bit, so collisions and label/coordinate
 * drift can split or merge distinct places — accepted for MVP until Apple
 * offers a server-side id. Keep this file free of runtime dependencies so
 * every package can import it (Next.js web app, Cloudflare Workers, vitest).
 */
export function stableApplePlaceId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `apple:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
