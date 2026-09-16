"use client";

/**
 * MapLibre GL basemap provider (map-home, BRAWUKA-311). The renderer
 * implementation behind `IMapProvider` — ported from the archived
 * `_archive-coffeemode-frontend/src/components/map/OpenFreeMap.tsx` with
 * deliberate fixes:
 *
 *  1. `attributionControl` is back ON — OpenMapTiles data requires visible
 *     attribution; the archive's `false` was a compliance bug.
 *  2. No `cn` helper in web/ — plain className join.
 *  3. Mount-once: `initialCenter`/`initialZoom` apply at construction only.
 *     The archive re-ran the effect on center/zoom changes yet guarded on
 *     `mapInstanceRef.current`, so post-mount prop changes were silently
 *     dropped. Camera moves now go through the `IMapProvider` adapter
 *     (`flyTo`/`setCenter`) handed to `onLoad`.
 *  4. `map.on("error")` no longer just logs: errors that are not per-tile
 *     failures (style/source/glyph/sprite fetch, WebGL init) surface through
 *     `onError` so the surface can degrade to an error UI. Per-tile errors
 *     stay non-fatal — a missing tile must not blank the basemap.
 *  5. All MapLibre internals live here: pin images, cafe source/layers,
 *     click/hover wiring, the `style.load` rebind that re-applies data +
 *     selection after a theme switch, and the theme→style-URL resolution
 *     (`map.maplibre.tileStyle` via maplibre-config.ts, BRAWUKA-329).
 *     Nothing outside this file (and cafe-pins.ts) imports maplibre-gl —
 *     the surface binds to `IMapProvider`, so a Google/Apple swap is a new
 *     provider, not a rewrite (owner directive 2026-09-16).
 *
 * No GeolocateControl: DG112 — geolocation is only ever user-triggered via
 * the onboarding LocateButton, never a map control.
 *
 * Optional IMapProvider capabilities (BRAWUKA-330): `onMapTap` (tap or
 * long-press/contextmenu on empty map → create-entry trigger), `getBounds`,
 * `onIdle` (MapLibre `moveend` — camera-settled, not the render-idle event,
 * so a data refresh can't retrigger "search this area"), and
 * `setExternalPins` (sage teardrop POI pins on a source/layers separate
 * from the cafe dataset).
 */
import { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Coordinates } from "@/lib/cities";
import type { CafeSummary } from "@/types/cafes";
import {
  bindCafeLayers,
  bindExternalPinLayers,
  cafesToGeoJSON,
  externalPinsToGeoJSON,
  loadPinImages,
  CAFE_SOURCE,
  CLUSTER_LAYER,
  EXTERNAL_PIN_LAYER,
  EXTERNAL_SOURCE,
  PIN_LAYER,
} from "./cafe-pins";
import { mapLibreStyleForTheme } from "./maplibre-config";
import type { BaseMapProviderProps, ExternalPin, IMapProvider } from "./types";

/** Internal mutable state the adapter closes over — latest cafes/selection
 * so a `style.load` rebind can re-apply them (a setStyle wipes both). */
interface ProviderState {
  cafes: CafeSummary[];
  externalPins: ExternalPin[];
  selectedCafeId: string | null;
  onCafeSelect: ((cafeId: string) => void) | null;
  onMapTap: ((coordinates: Coordinates) => void) | null;
}

/** Re-registers pin images + cafe/external layers and re-pushes
 * data/selection — called on mount and on every `style.load` (theme
 * switches wipe runtime layers and feature-state). */
function rebindMapLayers(map: MapLibreMap, state: ProviderState): void {
  void loadPinImages(map).then(() => {
    bindCafeLayers(map);
    bindExternalPinLayers(map);
    const cafeSource = map.getSource(CAFE_SOURCE);
    if (cafeSource instanceof GeoJSONSource) {
      cafeSource.setData(cafesToGeoJSON(state.cafes));
    }
    const externalSource = map.getSource(EXTERNAL_SOURCE);
    if (externalSource instanceof GeoJSONSource) {
      externalSource.setData(externalPinsToGeoJSON(state.externalPins));
    }
    if (state.selectedCafeId) {
      map.setFeatureState(
        { source: CAFE_SOURCE, id: state.selectedCafeId },
        { selected: true },
      );
    }
  });
}

function bindPointerHandlers(map: MapLibreMap, state: ProviderState): void {
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
    if (!hit) {
      // Empty-map tap → the registered map-tap handler (create entry).
      state.onMapTap?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      return;
    }
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
  // Long-press (mobile) / right-click (desktop) → same create-entry trigger.
  map.on("contextmenu", (e: MapMouseEvent) => {
    if (!state.onMapTap || hitPin(e)) return;
    e.preventDefault();
    state.onMapTap({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  });
  map.on("mousemove", (e: MapMouseEvent) => {
    const layers = interactiveLayers();
    if (layers.length === 0) return;
    const hit = map.queryRenderedFeatures(e.point, { layers });
    map.getCanvas().style.cursor = hit.length > 0 ? "pointer" : "";
  });
}

/** The imperative adapter handed to the surface — the only channel after
 * mount (initialCenter/initialZoom are constructor-time only). */
function providerAdapter(
  map: MapLibreMap,
  mapRef: React.RefObject<MapLibreMap | null>,
  state: ProviderState,
): IMapProvider {
  return {
    setCenter: (next) => map.setCenter([next.lng, next.lat]),
    setZoom: (next) => map.setZoom(next),
    getCenter: () => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    getZoom: () => map.getZoom(),
    flyTo: (next, nextZoom) => {
      map.flyTo({
        center: [next.lng, next.lat],
        zoom: nextZoom ?? map.getZoom(),
        essential: true,
      });
    },
    setPadding: (padding) => map.setPadding(padding),
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
    onCafeSelect: (handler) => {
      state.onCafeSelect = handler;
      return () => {
        if (state.onCafeSelect === handler) state.onCafeSelect = null;
      };
    },
    onMapTap: (handler) => {
      state.onMapTap = handler;
      return () => {
        if (state.onMapTap === handler) state.onMapTap = null;
      };
    },
    getBounds: () => {
      const b = map.getBounds();
      return {
        ne: { lat: b.getNorthEast().lat, lng: b.getNorthEast().lng },
        sw: { lat: b.getSouthWest().lat, lng: b.getSouthWest().lng },
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
    setExternalPins: (pins) => {
      state.externalPins = pins;
      const source = map.getSource(EXTERNAL_SOURCE);
      if (source instanceof GeoJSONSource) {
        source.setData(externalPinsToGeoJSON(pins));
      }
    },
    destroy: () => {
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    },
  };
}

/** Mount-once map construction + event wiring. Returns the cleanup. */
function mountMap(opts: {
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
    // source, glyphs, sprite) means the basemap cannot render.
    const tileBound = "tile" in e && Boolean(e.tile);
    if (!loaded && !tileBound) onErrorRef.current?.(e.error ?? e);
    else console.error("[map] non-fatal maplibre error:", e.error ?? e);
  });

  return () => {
    map.remove();
    if (mapRef.current === map) mapRef.current = null;
  };
}

export function MapLibreProvider({
  className,
  initialCenter,
  initialZoom,
  theme,
  ariaLabel,
  onLoad,
  onError,
}: BaseMapProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const stateRef = useRef<ProviderState>({
    cafes: [],
    externalPins: [],
    selectedCafeId: null,
    onCafeSelect: null,
    onMapTap: null,
  });
  // Latest-callback refs: the mount effect runs once, so it must call the
  // current props, not the first render's closures.
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onLoadRef.current = onLoad;
    onErrorRef.current = onError;
  });
  // Mount-once. `initial*` props are captured at construction; later camera
  // changes are imperative via the provider adapter.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    return mountMap({
      container,
      props: { initialCenter, initialZoom },
      style: mapLibreStyleForTheme(theme),
      mapRef,
      state: stateRef.current,
      onLoadRef,
      onErrorRef,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design
  }, []);

  // Style switching (theme light/dark): setStyle replaces the style in
  // place; the `style.load` rebind re-adds sources/layers/data/selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(mapLibreStyleForTheme(theme));
  }, [theme]);

  return (
    <div
      ref={containerRef}
      className={className ? `h-full w-full ${className}` : "h-full w-full"}
      aria-label={ariaLabel ?? "Map"}
    />
  );
}
