/**
 * TileJSON + style rewriting for the CafeMood tiles service (BRAWUKA-313).
 *
 * The bucket stores ONE versioned planet archive per build
 * (`planet/{version}/planet.pmtiles`, immutable) plus the same per-version
 * PBF layout the OpenFreeMap public instance serves — so the URL space the
 * web map surface (BRAWUKA-311) sees is identical across hostings:
 *
 *   GET /planet                  TileJSON pointing at the live version
 *   GET /planet/{z}/{x}/{y}.pbf  live-version vector tile (redirect)
 *   GET /planet/{version}/{z}/{x}/{y}.pbf  pinned-version tile (redirect)
 */

import type { Env } from "./types";

const TILE_RE = /^\/planet\/([0-9]+)\/([0-9]+)\/([0-9]+)\.pbf$/;
const VERSIONED_TILE_RE = /^\/planet\/([0-9]{8}_[0-9]{6}_pt)\/([0-9]+)\/([0-9]+)\/([0-9]+)\.pbf$/;

export function tilesJson(origin: string, version: string): Record<string, unknown> {
  return {
    tilejson: "3.0.0",
    name: "OpenFreeMap",
    description: "https://openfreemap.org",
    attribution:
      '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
      '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
      "Data from <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\">OpenStreetMap</a>",
    bounds: [-180.0, -85.05113, 180.0, 85.05113],
    center: [0.0, 0.0, 1],
    minzoom: 0,
    maxzoom: 14,
    tiles: [`${origin}/planet/${version}/{z}/{x}/{y}.pbf`],
    vector_layers: [
      { id: "water", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "waterway", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "landcover", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "landuse", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "park", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "boundary", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "aeroway", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "transportation", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "transportation_name", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "place", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "water_name", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "poi", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "aerodrome_label", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "mountain_peak", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "housenumber", fields: {}, minzoom: 0, maxzoom: 14 },
      { id: "building", fields: {}, minzoom: 0, maxzoom: 14 },
    ],
  };
}

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

export interface TileRoute {
  kind: "tilejson" | "tile" | "versioned-tile" | "not-found";
  version?: string;
  z?: number;
  x?: number;
  y?: number;
}

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

/** Public origin for absolute URLs (request URL fallback when unconfigured). */
export function publicOrigin(request: Request, env: Env): string {
  if (env.TILES_PUBLIC_ORIGIN) return env.TILES_PUBLIC_ORIGIN.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
