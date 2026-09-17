/**
 * Pin artwork + GeoJSON shaping for the discovery map (map-home).
 *
 * Pins are baked SVGs registered as MapLibre images — the spec 0001 marker
 * (espresso-brown circle, white cup, open/closed status dot) drawn once per
 * status variant instead of per-marker DOM nodes. Colors mirror globals.css
 * tokens (hex literals: style JSON can't read CSS custom properties).
 *
 * Also hosts the external-POI pin channel (BRAWUKA-330): a sage teardrop +
 * optional label on a separate source/layers, so live search results never
 * enter the cafe dataset.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Point } from "geojson";
import { isOpenAt } from "@/lib/hours";
import type { CafeSummary } from "@/types/cafes";
import type { ExternalPin } from "./types";

export const CAFE_SOURCE = "cafes";
export const CLUSTER_LAYER = "cafes-clusters";
export const CLUSTER_COUNT_LAYER = "cafes-cluster-count";
export const PIN_HALO_LAYER = "cafes-pin-halo";
export const PIN_LAYER = "cafes-pins";
export const EXTERNAL_SOURCE = "external-pois";
export const EXTERNAL_PIN_LAYER = "external-poi-pins";
export const EXTERNAL_LABEL_LAYER = "external-poi-labels";

/** Pin variants: open / closed / unknown. */
const STATUSES = ["open", "closed", "unknown"] as const;
type PinStatus = (typeof STATUSES)[number];

const PIN_IMAGE = (status: PinStatus) => `cafe-pin-${status}`;

// Token-matched palette (globals.css light): espresso brown pin, terracotta
// accent ring, sage open dot, muted closed dot. BRAWUKA-362: the pin carries
// a paper ring (PIN_CUP stroke) so it keeps its silhouette on the espresso
// dark basemap — body-on-bg contrast there is only ~1.5:1 without it.
const PIN_BODY = "#5b4232";
const PIN_CUP = "#faf7f2";
const DOT_OPEN = "#3d8a5f";
const DOT_CLOSED = "#8a8378";
const DOT_STROKE = "#faf7f2";

/** External-POI pin: sage teardrop (--secondary oklch(45% 0.08 155)), white
 * core — visually distinct from the espresso cafe cup. Same paper ring so it
 * survives the dark basemap. */
const EXTERNAL_PIN_BODY = "#2b6241";
const EXTERNAL_PIN_IMAGE = "external-poi-pin";

function externalPinSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">` +
    `<path d="M14 2C8.5 2 4 6.5 4 12c0 7.5 10 20 10 20s10-12.5 10-20c0-5.5-4.5-10-10-10z" fill="${EXTERNAL_PIN_BODY}" stroke="${PIN_CUP}" stroke-width="1.5"/>` +
    `<circle cx="14" cy="12" r="4" fill="${PIN_CUP}"/>` +
    `</svg>`
  );
}

function pinSvg(status: PinStatus): string {
  const dot =
    status === "unknown"
      ? ""
      : `<circle cx="30" cy="10" r="5" fill="${status === "open" ? DOT_OPEN : DOT_CLOSED}" stroke="${DOT_STROKE}" stroke-width="2"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">` +
    `<circle cx="18" cy="18" r="13" fill="${PIN_BODY}" stroke="${PIN_CUP}" stroke-width="2"/>` +
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


/** Registers one baked SVG as a MapLibre image; idempotent per style
 * generation (a setStyle wipes images, so callers re-run on style.load). */
async function addSvgImage(
  map: MapLibreMap,
  name: string,
  svg: string,
): Promise<void> {
  if (map.hasImage(name)) return;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
}

/** Register all pin variants on the map; idempotent per style generation. */
export async function loadPinImages(map: MapLibreMap): Promise<void> {
  await Promise.all([
    ...STATUSES.map((status) =>
      addSvgImage(map, PIN_IMAGE(status), pinSvg(status)),
    ),
    addSvgImage(map, EXTERNAL_PIN_IMAGE, externalPinSvg()),
  ]);
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

/** External POIs → unclustered GeoJSON on their own source — never mixed
 * into the cafe dataset. */
export function externalPinsToGeoJSON(
  pins: ExternalPin[],
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => ({
      type: "Feature",
      id: pin.id,
      geometry: {
        type: "Point",
        coordinates: [pin.coordinates.lng, pin.coordinates.lat],
      },
      properties: { pinId: pin.id, label: pin.label ?? "" },
    })),
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
        // Paper ring (BRAWUKA-362): same silhouette guarantee as the pin —
        // espresso-on-espresso is ~1.5:1 on the dark basemap without it.
        "circle-stroke-color": PIN_CUP,
        "circle-stroke-width": 2,
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

/** Add the external-POI source + pin/label layers. Called on every
 * `style.load` alongside `bindCafeLayers` — a setStyle wipes runtime layers. */
export function bindExternalPinLayers(map: MapLibreMap): void {
  if (!map.getSource(EXTERNAL_SOURCE)) {
    map.addSource(EXTERNAL_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      promoteId: "pinId",
    });
  }
  if (!map.getLayer(EXTERNAL_PIN_LAYER)) {
    map.addLayer({
      id: EXTERNAL_PIN_LAYER,
      type: "symbol",
      source: EXTERNAL_SOURCE,
      layout: {
        "icon-image": EXTERNAL_PIN_IMAGE,
        "icon-size": 1,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
      },
    });
  }
  if (!map.getLayer(EXTERNAL_LABEL_LAYER)) {
    map.addLayer({
      id: EXTERNAL_LABEL_LAYER,
      type: "symbol",
      source: EXTERNAL_SOURCE,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.15],
        "text-optional": true,
      },
      paint: {
        "text-color": PIN_BODY,
        "text-halo-color": PIN_CUP,
        "text-halo-width": 1.5,
      },
    });
  }
}
