/**
 * Cafe pin artwork + GeoJSON shaping for the discovery map (map-home).
 *
 * Pins are baked SVGs registered as MapLibre images — the spec 0001 marker
 * (espresso-brown circle, white cup, open/closed status dot) drawn once per
 * status variant instead of per-marker DOM nodes. Colors mirror globals.css
 * tokens (hex literals: style JSON can't read CSS custom properties).
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { isOpenAt } from "@/lib/hours";
import type { CafeSummary } from "@/types/cafes";

export const CAFE_SOURCE = "cafes";
export const CLUSTER_LAYER = "cafes-clusters";
export const CLUSTER_COUNT_LAYER = "cafes-cluster-count";
export const PIN_HALO_LAYER = "cafes-pin-halo";
export const PIN_LAYER = "cafes-pins";

/** Pin variants: open / closed / unknown. */
const STATUSES = ["open", "closed", "unknown"] as const;
type PinStatus = (typeof STATUSES)[number];

const PIN_IMAGE = (status: PinStatus) => `cafe-pin-${status}`;

// Token-matched palette (globals.css light): espresso brown pin, terracotta
// accent ring, sage open dot, muted closed dot.
const PIN_BODY = "#5b4232";
const PIN_CUP = "#faf7f2";
const DOT_OPEN = "#3d8a5f";
const DOT_CLOSED = "#8a8378";
const DOT_STROKE = "#faf7f2";

function pinSvg(status: PinStatus): string {
  const dot =
    status === "unknown"
      ? ""
      : `<circle cx="30" cy="10" r="5" fill="${status === "open" ? DOT_OPEN : DOT_CLOSED}" stroke="${DOT_STROKE}" stroke-width="2"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">` +
    `<circle cx="18" cy="18" r="13" fill="${PIN_BODY}"/>` +
    // Cup: bowl + handle + saucer, white on espresso.
    `<g fill="none" stroke="${PIN_CUP}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M12.5 14.5h9v4.2a4.5 4.5 0 0 1-9 0z" fill="${PIN_CUP}" stroke="none"/>` +
    `<path d="M21.5 15.5h1.6a2.4 2.4 0 0 1 0 4.8h-1.6"/>` +
    `<path d="M12 24.5h12"/>` +
    `</g>` +
    dot +
    `</svg>`
  );
}

/** Register all pin variants on the map; idempotent per style generation. */
export async function loadPinImages(map: MapLibreMap): Promise<void> {
  await Promise.all(
    STATUSES.map(async (status) => {
      const name = PIN_IMAGE(status);
      if (map.hasImage(name)) return;
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg(status))}`;
      await img.decode();
      if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
    }),
  );
}

/** Cafes → clustered GeoJSON. `open` is evaluated once per data refresh —
 * the dot is a hint, not a live clock. */
export function cafesToGeoJSON(cafes: CafeSummary[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: cafes.map((cafe) => {
      const open = isOpenAt(cafe.opening_hours, cafe.tz);
      const status: PinStatus = open === null ? "unknown" : open ? "open" : "closed";
      return {
        type: "Feature",
        id: cafe.id,
        geometry: { type: "Point", coordinates: [cafe.lng, cafe.lat] },
        properties: { cafeId: cafe.id, icon: PIN_IMAGE(status) },
      };
    }),
  };
}

/** Add the cafe source + cluster/pin layers. Called on every `style.load`
 * (initial load and each theme switch) — a setStyle wipes runtime layers. */
export function bindCafeLayers(map: MapLibreMap): void {
  if (!map.getSource(CAFE_SOURCE)) {
    map.addSource(CAFE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 48,
      promoteId: "cafeId",
    });
  }
  if (!map.getLayer(CLUSTER_LAYER)) {
    map.addLayer({
      id: CLUSTER_LAYER,
      type: "circle",
      source: CAFE_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": PIN_BODY,
        "circle-opacity": 0.9,
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 26],
      },
    });
  }
  if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
    map.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: "symbol",
      source: CAFE_SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
      },
      paint: { "text-color": PIN_CUP },
    });
  }
  // Selection halo: feature-state driven ring under the pin.
  if (!map.getLayer(PIN_HALO_LAYER)) {
    map.addLayer({
      id: PIN_HALO_LAYER,
      type: "circle",
      source: CAFE_SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 17,
        "circle-color": "#b0603c",
        "circle-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          0.35,
          0,
        ],
      },
    });
  }
  if (!map.getLayer(PIN_LAYER)) {
    map.addLayer({
      id: PIN_LAYER,
      type: "symbol",
      source: CAFE_SOURCE,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 1,
        "icon-allow-overlap": true,
      },
    });
  }
}
