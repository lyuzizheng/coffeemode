"use client";

/**
 * Camera + data bindings between the discovery state and the live MapLibre
 * instance (map-home). Kept out of discovery-map.tsx so the component stays
 * under the function-size budget — every effect here is a one-way sync:
 * discovery state → map. Nothing writes back (DG120: no recenter fights).
 */
import { useEffect, useRef, type RefObject } from "react";
import { GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { getMapDefaultZoom, getMapFocusZoom } from "@/lib/client-env";
import type { Coordinates } from "@/lib/cities";
import type { CafeSummary } from "@/types/cafes";
import { cafesToGeoJSON, CAFE_SOURCE } from "./cafe-pins";
import type { IMapProvider } from "./types";

/** Mobile sheet PEEK height (mobile-sheet.tsx PEEK_VISIBLE_PX) — keeps pins
 * and the attribution control above the collapsed sheet. */
const SHEET_PEEK_PX = 172;
/** Desktop detail column width (desktop-discovery.tsx) — overlays the map
 * below xl, so the camera must shift right when a cafe is selected. */
const DETAIL_COLUMN_PX = 400;

export interface MapBindingRefs {
  providerRef: RefObject<IMapProvider | null>;
  mapRef: RefObject<MapLibreMap | null>;
}

/** Camera padding: mobile keeps pins above the sheet's visible height;
 * desktop shifts right only while the detail column overlays the map. */
export function useMapPadding(
  { mapRef }: MapBindingRefs,
  opts: {
    isDesktop: boolean;
    isXl: boolean;
    snap: string;
    selectedCafeId: string | null;
    mapReady: boolean;
  },
): void {
  const { isDesktop, isXl, snap, selectedCafeId, mapReady } = opts;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const bottom = isDesktop
      ? 0
      : snap === "full"
        ? Math.round(window.innerHeight * 0.85)
        : snap === "half"
          ? Math.round(window.innerHeight * 0.5)
          : SHEET_PEEK_PX;
    const left = isDesktop && !isXl && selectedCafeId ? DETAIL_COLUMN_PX : 0;
    map.setPadding({ top: 0, right: 0, bottom, left });
  }, [mapRef, isDesktop, isXl, snap, selectedCafeId, mapReady]);
}

export function useCenterSync(
  { providerRef }: MapBindingRefs,
  center: Coordinates | null,
  mapReady: boolean,
): void {
  // The constructor's center — captured at first render, which is the same
  // commit the provider mounts in. Comparing against it (not "last flown")
  // covers centers that changed while the map was still loading.
  const appliedCenterRef = useRef<Coordinates | null>(center);
  useEffect(() => {
    if (!center || !mapReady) return;
    const prev = appliedCenterRef.current;
    if (prev && prev.lat === center.lat && prev.lng === center.lng) return;
    appliedCenterRef.current = center;
    const provider = providerRef.current;
    if (!provider) return;
    provider.flyTo(center, Math.max(provider.getZoom(), getMapDefaultZoom()));
  }, [providerRef, center, mapReady]);
}

/** Selection → flyTo at street zoom; deselect leaves the camera alone. */
export function useSelectionCamera(
  { providerRef }: MapBindingRefs,
  selectedCafeId: string | null,
  cafes: CafeSummary[],
  mapReady: boolean,
): void {
  const lastFlownCafeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCafeId || !mapReady) {
      lastFlownCafeRef.current = null;
      return;
    }
    if (lastFlownCafeRef.current === selectedCafeId) return;
    const cafe = cafes.find((c) => c.id === selectedCafeId);
    const provider = providerRef.current;
    if (!cafe || !provider) return;
    lastFlownCafeRef.current = selectedCafeId;
    provider.flyTo(
      { lat: cafe.lat, lng: cafe.lng },
      Math.max(provider.getZoom(), getMapFocusZoom()),
    );
  }, [providerRef, selectedCafeId, cafes, mapReady]);
}

/** Cafes → clustered GeoJSON + the selection ring via feature-state. The
 * ring clears the previous pin first; setData re-applies the current one. */
export function useCafeData(
  { mapRef }: MapBindingRefs,
  cafes: CafeSummary[],
  selectedCafeId: string | null,
  mapReady: boolean,
): void {
  const prevSelectedRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(CAFE_SOURCE);
    if (!(source instanceof GeoJSONSource)) return;
    source.setData(cafesToGeoJSON(cafes));
    if (selectedCafeId) {
      map.setFeatureState(
        { source: CAFE_SOURCE, id: selectedCafeId },
        { selected: true },
      );
    }
  }, [mapRef, cafes, selectedCafeId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource(CAFE_SOURCE)) return;
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedCafeId;
    if (prev && prev !== selectedCafeId) {
      map.setFeatureState({ source: CAFE_SOURCE, id: prev }, { selected: false });
    }
    if (selectedCafeId) {
      map.setFeatureState(
        { source: CAFE_SOURCE, id: selectedCafeId },
        { selected: true },
      );
    }
  }, [mapRef, selectedCafeId, mapReady]);
}
