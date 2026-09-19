"use client";

/**
 * Camera + data bindings between the discovery state and the map provider
 * (map-home, BRAWUKA-311). Renderer-agnostic: everything goes through
 * `IMapProvider` — no maplibre/mapkit/google types cross this file, so a
 * provider swap never touches the bindings.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { Coordinates } from "@/lib/cities";
import { getMapDefaultZoom, getMapFocusZoom } from "@/lib/client-env";
import type { CafeSummary } from "@/types/cafes";
import type { IMapProvider } from "./types";
import { DETAIL_COLUMN_PX, SHEET_COLLAPSED_PX, SHEET_PEEK_PX } from "@/lib/layout";

export interface MapBindingRefs {
  providerRef: RefObject<IMapProvider | null>;
}

/** Camera padding: mobile keeps pins above the sheet's visible height;
 * desktop shifts right only while the detail column overlays the map. */
export function useMapPadding(
  { providerRef }: MapBindingRefs,
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
    const provider = providerRef.current;
    if (!provider || !mapReady) return;
    const bottom = isDesktop
      ? 0
      : snap === "full"
        ? Math.round(window.innerHeight * 0.85)
        : snap === "half"
          ? Math.round(window.innerHeight * 0.5)
          : snap === "collapsed"
            ? SHEET_COLLAPSED_PX
            : SHEET_PEEK_PX;
    const left = isDesktop && !isXl && selectedCafeId ? DETAIL_COLUMN_PX : 0;
    provider.setPadding({ top: 0, right: 0, bottom, left });
  }, [providerRef, isDesktop, isXl, snap, selectedCafeId, mapReady]);
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
  const evaluatedRef = useRef(false);
  useEffect(() => {
    if (!center || !mapReady) return;
    const provider = providerRef.current;
    if (!provider) return;
    const prev = appliedCenterRef.current;
    const firstEval = !evaluatedRef.current;
    evaluatedRef.current = true;
    appliedCenterRef.current = center;
    if (prev && prev.lat === center.lat && prev.lng === center.lng) {
      // First evaluation at the constructor center: skip — a pan during map
      // load must never be yanked back. Later same-target re-applications
      // (locate re-tap) recenter only when the camera actually moved away —
      // DG120's "re-tap recenters on the dot" would otherwise dead-end on
      // the unchanged center value.
      if (firstEval) return;
      const current = provider.getCenter();
      const atTarget =
        Math.abs(current.lat - center.lat) < 1e-5 &&
        Math.abs(current.lng - center.lng) < 1e-5;
      if (atTarget) return;
    }
    // settle.slow ceiling (spec 0002 ≤450ms) for every center-driven beat.
    provider.flyTo(center, Math.max(provider.getZoom(), getMapDefaultZoom()), 450);
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

/** Cafes → provider dataset; selection → provider halo. Data and selection
 * are separate channels — a selection change no longer re-uploads GeoJSON. */
export function useCafeData(
  { providerRef }: MapBindingRefs,
  cafes: CafeSummary[],
  selectedCafeId: string | null,
  mapReady: boolean,
): void {
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !mapReady) return;
    provider.setCafes(cafes);
  }, [providerRef, cafes, mapReady]);

  useEffect(() => {
    const provider = providerRef.current;
    if (!provider || !mapReady) return;
    provider.setSelectedCafe(selectedCafeId);
  }, [providerRef, selectedCafeId, mapReady]);
}
