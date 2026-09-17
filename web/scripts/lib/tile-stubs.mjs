/**
 * OpenFreeMap tile-host stub for offline e2e/visual runs (map-home,
 * BRAWUKA-311). Same pattern as the apple-mapkit/maps.googleapis.com stubs:
 * every request to the tile host is answered locally so the suites never
 * touch the network. Responses are minimal-but-valid — an empty vector tile
 * or glyph range is a legal empty protobuf, so MapLibre renders an empty
 * basemap instead of erroring.
 */

/** Minimal style JSON for remote style URLs — a bare background layer.
 * (BRAWUKA-362: the app now serves its own style documents same-origin from
 * `web/public/map/`; this stub still covers the tile/glyph/sprite fetches
 * those documents make to the tile host.) */
const EMPTY_STYLE = JSON.stringify({
  version: 8,
  name: "stub-dark",
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#1a1714" } }],
});

/** TileJSON for the vector source — tiles point back at the same stubbed
 * host so tile fetches are intercepted too. */
const TILE_JSON = JSON.stringify({
  tilejson: "3.0.0",
  name: "stub",
  tiles: ["https://tiles.openfreemap.org/stub/{z}/{x}/{y}.pbf"],
  minzoom: 0,
  maxzoom: 14,
  attribution: "© OpenMapTiles © OpenStreetMap contributors",
});

/** 1×1 transparent PNG for sprite sheets. */
const EMPTY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Register the tile-host stub on a Playwright browser context. */
export async function stubOpenFreeMap(context) {
  await context.route("**://tiles.openfreemap.org/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/styles/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY_STYLE });
    }
    if (path.startsWith("/sprites/")) {
      return path.endsWith(".png")
        ? route.fulfill({ status: 200, contentType: "image/png", body: EMPTY_PNG })
        : route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    // Empty protobuf: valid empty vector tile AND valid empty glyph range.
    if (path.endsWith(".pbf")) {
      return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.alloc(0) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: TILE_JSON });
  });
}
