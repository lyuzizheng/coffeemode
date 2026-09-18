/**
 * Mount-once map construction + the IMapProvider adapter (BRAWUKA-311,
 * split from maplibre-provider.tsx for the 400-line budget). Everything
 * here is MapLibre-internal: the adapter closes over the live map and the
 * shared ProviderState so a `style.load` rebind can re-apply data.
 */
import { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type {
  BaseMapProviderProps,
  IMapProvider,
} from "./types";
import {
  cafesToGeoJSON,
  externalPinsToGeoJSON,
  userLocationToGeoJSON,
  CAFE_SOURCE,
  EXTERNAL_SOURCE,
  USER_LOCATION_SOURCE,
} from "./cafe-pins";
import type { ProviderState } from "./maplibre-state";
import { rebindMapLayers, bindPointerHandlers } from "./maplibre-state";

/** The imperative adapter handed to the surface — the only channel after
 * mount (initialCenter/initialZoom are constructor-time only). */
function providerAdapter(
  map: MapLibreMap,
  mapRef: React.RefObject<MapLibreMap | null>,
  state: ProviderState,
): IMapProvider {
  return {
    ...cameraAdapter(map),
    ...dataAdapter(map, state),
    ...handlerAdapter(map, mapRef, state),
  };
}

/** Camera + viewport methods — the IMapProvider movement surface. */
function cameraAdapter(map: MapLibreMap): Pick<IMapProvider, "setCenter" | "setZoom" | "getCenter" | "getZoom" | "flyTo" | "setPadding" | "getBounds"> {
  return {
    setCenter: (next) => map.setCenter([next.lng, next.lat]),
    setZoom: (next) => map.setZoom(next),
    getCenter: () => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    getZoom: () => map.getZoom(),
    flyTo: (next, nextZoom, durationMs) => {
      map.flyTo({
        center: [next.lng, next.lat],
        zoom: nextZoom ?? map.getZoom(),
        ...(typeof durationMs === "number" ? { duration: durationMs } : {}),
        essential: true,
      });
    },
    setPadding: (padding) => map.setPadding(padding),
    getBounds: () => {
      const b = map.getBounds();
      return {
        ne: { lat: b.getNorthEast().lat, lng: b.getNorthEast().lng },
        sw: { lat: b.getSouthWest().lat, lng: b.getSouthWest().lng },
      };
    },
  };
}

/** Data pushes — cafes, selection, external pins, the user-location dot. */
function dataAdapter(map: MapLibreMap, state: ProviderState): Pick<IMapProvider, "setCafes" | "setSelectedCafe" | "setExternalPins" | "setUserLocation"> {
  return {
    setCafes: (cafes) => {
      state.cafes = cafes;
      const source = map.getSource(CAFE_SOURCE);
      if (source instanceof GeoJSONSource) {
        source.setData(cafesToGeoJSON(cafes));
      }
    },
    setSelectedCafe: (cafeId) => {
      const prev = state.selectedCafeId;
      state.selectedCafeId = cafeId;
      if (!map.getSource(CAFE_SOURCE)) return;
      if (prev && prev !== cafeId) {
        map.setFeatureState({ source: CAFE_SOURCE, id: prev }, { selected: false });
      }
      if (cafeId) {
        map.setFeatureState({ source: CAFE_SOURCE, id: cafeId }, { selected: true });
      }
    },
    setExternalPins: (pins) => {
      state.externalPins = pins;
      const source = map.getSource(EXTERNAL_SOURCE);
      if (source instanceof GeoJSONSource) {
        source.setData(externalPinsToGeoJSON(pins));
      }
    },
    setUserLocation: (location) => {
      state.userLocation = location;
      const source = map.getSource(USER_LOCATION_SOURCE);
      if (source instanceof GeoJSONSource) {
        source.setData(userLocationToGeoJSON(location));
      }
    },
  };
}

/** Event subscriptions + lifecycle — every method returns its unsubscribe. */
function handlerAdapter(
  map: MapLibreMap,
  mapRef: React.RefObject<MapLibreMap | null>,
  state: ProviderState,
): Pick<IMapProvider, "onCafeSelect" | "onIdle" | "onCameraGesture" | "destroy"> {
  return {
    onCafeSelect: (handler) => {
      state.onCafeSelect = handler;
      return () => {
        if (state.onCafeSelect === handler) state.onCafeSelect = null;
      };
    },
    // MapLibre `moveend` — camera-settled only. `idle` also fires after
    // data/style renders, which would retrigger "search this area" on every
    // setExternalPins push.
    onIdle: (handler) => {
      map.on("moveend", handler);
      return () => {
        map.off("moveend", handler);
      };
    },
    onCameraGesture: (handler) => {
      state.onCameraGesture = handler;
      return () => {
        if (state.onCameraGesture === handler) state.onCameraGesture = null;
      };
    },
    destroy: () => {
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    },
  };
}

/** Mount-once map construction + event wiring. Returns the cleanup. */
export function mountMap(opts: {
  container: HTMLDivElement;
  props: Pick<BaseMapProviderProps, "initialCenter" | "initialZoom">;
  style: string;
  mapRef: React.RefObject<MapLibreMap | null>;
  state: ProviderState;
  onLoadRef: React.RefObject<BaseMapProviderProps["onLoad"]>;
  onErrorRef: React.RefObject<BaseMapProviderProps["onError"]>;
}): () => void {
  const { container, props, style, mapRef, state, onLoadRef, onErrorRef } = opts;
  let map: MapLibreMap;
  try {
    map = new MapLibreMap({
      container,
      style,
      center: [props.initialCenter.lng, props.initialCenter.lat],
      zoom: props.initialZoom,
      // Compliance: OpenMapTiles attribution must stay visible.
      attributionControl: { compact: false },
    });
  } catch (err) {
    // WebGL unavailable / style unparseable — degrade, don't crash.
    onErrorRef.current?.(err);
    return () => {};
  }
  mapRef.current = map;

  let loaded = false;
  map.on("load", () => {
    loaded = true;
    rebindMapLayers(map, state);
    bindPointerHandlers(map, state);
    map.on("style.load", () => rebindMapLayers(map, state));
    onLoadRef.current?.(providerAdapter(map, mapRef, state));
  });

  map.on("error", (e) => {
    // Per-tile failures (e.tile set) are routine — a dropped tile leaves a
    // hole, not a dead map. Everything else before first paint (style,
    // source, glyphs, sprite) means the basemap cannot render; the same is
    // true for an error while a theme-switch setStyle is in flight — the
    // style was already swapped out, so the map would sit silently blank.
    const tileBound = "tile" in e && Boolean(e.tile);
    if ((!loaded || state.stylePending) && !tileBound) {
      state.stylePending = false;
      onErrorRef.current?.(e.error ?? e);
    } else {
      console.error("[map] non-fatal maplibre error:", e.error ?? e);
    }
  });

  return () => {
    map.remove();
    if (mapRef.current === map) mapRef.current = null;
  };
}
