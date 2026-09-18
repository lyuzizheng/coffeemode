/**
 * Shared mutable state + layer/pointer wiring for the MapLibre provider
 * (BRAWUKA-311, split from maplibre-provider.tsx for the 400-line budget).
 * The adapter (maplibre-mount.ts) and the component (maplibre-provider.tsx)
 * both close over one ProviderState so a `style.load` rebind can re-apply
 * the latest data after a theme switch wipes runtime layers.
 */
import { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { MapMouseEvent } from "maplibre-gl";
import type { CafeSummary } from "@/types/cafes";
import type { ExternalPin, UserLocation } from "./types";
import {
  bindCafeLayers,
  bindExternalPinLayers,
  bindUserLocationLayers,
  cafesToGeoJSON,
  externalPinsToGeoJSON,
  loadPinImages,
  userLocationToGeoJSON,
  CAFE_SOURCE,
  CLUSTER_LAYER,
  EXTERNAL_PIN_LAYER,
  EXTERNAL_SOURCE,
  PIN_LAYER,
  USER_LOCATION_SOURCE,
} from "./cafe-pins";

/** Internal mutable state the adapter closes over — latest cafes/selection
 * so a `style.load` rebind can re-apply them (a setStyle wipes both). */
export interface ProviderState {
  cafes: CafeSummary[];
  externalPins: ExternalPin[];
  userLocation: UserLocation | null;
  selectedCafeId: string | null;
  onCafeSelect: ((cafeId: string) => void) | null;
  /** First user-initiated camera gesture (DG119) — movestart events carry
   * `originalEvent` only for real input, so programmatic flyTo never fires. */
  onCameraGesture: (() => void) | null;
  /** A setStyle (theme switch) is in flight — an error while set leaves the
   * map without a working style, so it escalates to onError like a
   * first-load failure instead of logging to a silently blank map. */
  stylePending: boolean;
}

/** Re-registers pin images + cafe/external layers and re-pushes
 * data/selection — called on mount and on every `style.load` (theme
 * switches wipe runtime layers and feature-state). */
export function rebindMapLayers(map: MapLibreMap, state: ProviderState): void {
  state.stylePending = false;
  void loadPinImages(map).then(() => {
    bindCafeLayers(map);
    bindExternalPinLayers(map);
    bindUserLocationLayers(map);
    const cafeSource = map.getSource(CAFE_SOURCE);
    if (cafeSource instanceof GeoJSONSource) {
      cafeSource.setData(cafesToGeoJSON(state.cafes));
    }
    const externalSource = map.getSource(EXTERNAL_SOURCE);
    if (externalSource instanceof GeoJSONSource) {
      externalSource.setData(externalPinsToGeoJSON(state.externalPins));
    }
    const userSource = map.getSource(USER_LOCATION_SOURCE);
    if (userSource instanceof GeoJSONSource) {
      userSource.setData(userLocationToGeoJSON(state.userLocation));
    }
    if (state.selectedCafeId) {
      map.setFeatureState(
        { source: CAFE_SOURCE, id: state.selectedCafeId },
        { selected: true },
      );
    }
  });
}

export function bindPointerHandlers(map: MapLibreMap, state: ProviderState): void {
  const interactiveLayers = () =>
    [PIN_LAYER, CLUSTER_LAYER, EXTERNAL_PIN_LAYER].filter((id) =>
      map.getLayer(id),
    );

  /** First rendered feature under the point across pin/cluster layers. */
  const hitPin = (e: MapMouseEvent) => {
    const layers = interactiveLayers();
    if (layers.length === 0) return undefined;
    return map.queryRenderedFeatures(e.point, { layers }).at(0);
  };

  map.on("click", (e: MapMouseEvent) => {
    const hit = hitPin(e);
    if (!hit) return;
    if (hit.properties?.cluster) {
      const source = map.getSource(CAFE_SOURCE);
      if (source instanceof GeoJSONSource) {
        void source
          .getClusterExpansionZoom(hit.properties.cluster_id as number)
          .then((zoom: number) => map.easeTo({ center: e.lngLat, zoom }));
      }
      return;
    }
    const cafeId = hit.properties?.cafeId;
    if (typeof cafeId === "string") state.onCafeSelect?.(cafeId);
  });
  // First user camera gesture (DG119): `movestart` carries `originalEvent`
  // only for real input (drag/scroll/pinch/keyboard) — flyTo/easeTo/jumpTo
  // never do, so the locate recenter can't trip its own latch.
  map.on("movestart", (e) => {
    if (e.originalEvent) state.onCameraGesture?.();
  });
  map.on("mousemove", (e: MapMouseEvent) => {
    const layers = interactiveLayers();
    if (layers.length === 0) return;
    const hit = map.queryRenderedFeatures(e.point, { layers });
    map.getCanvas().style.cursor = hit.length > 0 ? "pointer" : "";
  });
}
