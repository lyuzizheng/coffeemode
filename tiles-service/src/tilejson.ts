/**
 * TileJSON + style rewriting for the CafeMood tiles service (BRAWUKA-313).
 *
 * The bucket stores ONE versioned planet archive per build
 * (`planet/{version}/planet.pmtiles`, immutable) plus the same per-version
 * PBF layout the OpenFreeMap public instance serves — so the URL space the
 * web map surface (BRAWUKA-311) sees is identical across hostings:
 *   GET /planet                  TileJSON pointing at the live version
 *   GET /planet/{z}/{x}/{y}.pbf  live-version tile BYTES (range-read)
 *   GET /planet/{version}/{z}/{x}/{y}.pbf  pinned-version tile BYTES (range-read)
 */

const TILE_RE = /^\/planet\/([0-9]+)\/([0-9]+)\/([0-9]+)\.pbf$/;
const VERSIONED_TILE_RE = /^\/planet\/([0-9]{8}_[0-9]{6}_pt)\/([0-9]+)\/([0-9]+)\/([0-9]+)\.pbf$/;

/**
 * Rewrite a public OpenFreeMap style document against the self-hosted
 * origin (same transform `build-maptiles.sh` step 6 applies at upload
 * time, kept here so ad-hoc `/styles/<name>` requests stay consistent).
 * Returns null when the body is not a style document.
 */
export function rewriteStyle(body: string, origin: string): string | null {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sources = doc.sources as Record<string, Record<string, unknown>> | undefined;
  const openmaptiles = sources?.openmaptiles;
  if (!openmaptiles || typeof openmaptiles !== "object") return null;
  if (openmaptiles.url === "https://tiles.openfreemap.org/planet") {
    openmaptiles.url = `${origin}/planet`;
  }
  if (typeof doc.glyphs === "string" && doc.glyphs.includes("tiles.openfreemap.org")) {
    doc.glyphs = doc.glyphs.replace("https://tiles.openfreemap.org", origin);
  }
  if (typeof doc.sprite === "string" && doc.sprite.includes("tiles.openfreemap.org")) {
    doc.sprite = doc.sprite.replace("https://tiles.openfreemap.org", origin);
  }
  return JSON.stringify(doc);
}

export type TileRoute =
  | { kind: "tilejson" }
  | { kind: "tile"; z: number; x: number; y: number }
  | { kind: "versioned-tile"; version: string; z: number; x: number; y: number }
  | { kind: "not-found" };

export function routeTile(path: string): TileRoute {
  if (path === "/planet" || path === "/planet/") return { kind: "tilejson" };
  const versioned = VERSIONED_TILE_RE.exec(path);
  if (versioned) {
    return {
      kind: "versioned-tile",
      version: versioned[1],
      z: Number(versioned[2]),
      x: Number(versioned[3]),
      y: Number(versioned[4]),
    };
  }
  const live = TILE_RE.exec(path);
  if (live) {
    return {
      kind: "tile",
      z: Number(live[1]),
      x: Number(live[2]),
      y: Number(live[3]),
    };
  }
  return { kind: "not-found" };
}
