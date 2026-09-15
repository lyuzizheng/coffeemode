"use client";

/**
 * Discovery map surface (map-home, BRAWUKA-311): the live basemap behind the
 * discovery sheet/sidebar. Binds the shared discovery state (context) to the
 * OpenFreeMap provider:
 *
 *  - cafes → clustered GeoJSON pins (spec 0001 marker: espresso circle,
 *    white cup, open/closed dot); pin tap → controller.select (URL sync is
 *    the controller's), cluster tap → zoom in.
 *  - selectedCafeId → flyTo at focus zoom; center changes (locate, city
 *    pick) → flyTo at city zoom. User pans never write back, so there is no
 *    recenter fight (DG120).
 *  - Theme light/dark swaps the basemap style in place; cafe layers rebind
 *    on every style.load.
 *  - Basemap failure degrades to an error card — the sheet keeps working
 *    because the data path never touches the map.
 *
 * Loaded via next/dynamic ssr:false from map-surface.tsx — this module owns
 * the maplibre-gl import graph.
 */
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSONSource } from "maplibre-gl";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import {
  getMapDefaultZoom,
  getMapTileStyleDark,
  getMapTileStyleLight,
} from "@/lib/client-env";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useDiscoveryMap } from "@/lib/discovery/map-context";
import { OpenFreeMapProvider } from "./openfreemap-provider";
import {
  bindCafeLayers,
  cafesToGeoJSON,
  loadPinImages,
  CAFE_SOURCE,
  CLUSTER_LAYER,
  PIN_LAYER,
} from "./cafe-pins";
import {
  useCafeData,
  useCenterSync,
  useMapPadding,
  useSelectionCamera,
} from "./use-map-bindings";
import type { IMapProvider } from "./types";
import type { CafeSummary } from "@/types/cafes";

/** Pins + clusters + pointer affordance, bound once per map instance. The
 * cafe layers re-register on every `style.load` (theme switches wipe them);
 * each (re)bind also pushes the latest cafe data so cafes that arrived
 * before the map finished loading are never dropped. */
function bindMapInteractions(
  map: MapLibreMap,
  selectRef: React.RefObject<((id: string) => void) | null>,
  cafesRef: React.RefObject<CafeSummary[]>,
): void {
  const rebind = () => {
    void loadPinImages(map).then(() => {
      bindCafeLayers(map);
      const source = map.getSource(CAFE_SOURCE);
      if (source instanceof GeoJSONSource) {
        source.setData(cafesToGeoJSON(cafesRef.current ?? []));
      }
    });
  };
  rebind();
  map.on("style.load", rebind);

  const interactiveLayers = () =>
    [PIN_LAYER, CLUSTER_LAYER].filter((id) => map.getLayer(id));

  map.on("click", (e: MapMouseEvent) => {
    const layers = interactiveLayers();
    if (layers.length === 0) return;
    const hit = map.queryRenderedFeatures(e.point, { layers }).at(0);
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
    if (typeof cafeId === "string") selectRef.current?.(cafeId);
  });
  map.on("mousemove", (e: MapMouseEvent) => {
    const layers = interactiveLayers();
    if (layers.length === 0) return;
    const hit = map.queryRenderedFeatures(e.point, { layers });
    map.getCanvas().style.cursor = hit.length > 0 ? "pointer" : "";
  });
}

export function DiscoveryMap({ onError }: { onError: (err: unknown) => void }) {
  const t = useTranslations("map");
  const state = useDiscoveryMap();
  const { resolvedTheme } = useTheme();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isXl = useMediaQuery("(min-width: 1280px)");

  const providerRef = useRef<IMapProvider | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // Latest select callback for the mount-time click handler.
  const selectRef = useRef<((id: string) => void) | null>(null);
  useEffect(() => {
    selectRef.current = state?.controller.select ?? null;
  });

  const style = useMemo(
    () => (resolvedTheme === "dark" ? getMapTileStyleDark() : getMapTileStyleLight()),
    [resolvedTheme],
  );

  const center = state?.center ?? null;
  const cafes = useMemo(() => state?.cafes ?? [], [state?.cafes]);
  // Latest cafes for the bind-time data push (cafes can arrive before the
  // map finishes loading — the effect below would have no source yet).
  const cafesRef = useRef<CafeSummary[]>(cafes);
  useEffect(() => {
    cafesRef.current = cafes;
  });
  const selectedCafeId = state?.controller.selectedCafeId ?? null;
  const snap = state?.controller.snap ?? "peek";
  const [mapReady, setMapReady] = useState(false);
  const handleLoad = useCallback((provider: IMapProvider, map: MapLibreMap) => {
    providerRef.current = provider;
    mapRef.current = map;
    bindMapInteractions(map, selectRef, cafesRef);
    setMapReady(true);
  }, []);

  const refs = { providerRef, mapRef };
  useMapPadding(refs, { isDesktop, isXl, snap, selectedCafeId, mapReady });
  useCenterSync(refs, center, mapReady);
  useSelectionCamera(refs, selectedCafeId, cafes, mapReady);
  useCafeData(refs, cafes, selectedCafeId, mapReady);

  if (!state) return null;

  return (
    <OpenFreeMapProvider
      className="absolute inset-0"
      initialCenter={state.center}
      initialZoom={getMapDefaultZoom()}
      style={style}
      ariaLabel={t("aria")}
      onLoad={handleLoad}
      onError={onError}
    />
  );
}
