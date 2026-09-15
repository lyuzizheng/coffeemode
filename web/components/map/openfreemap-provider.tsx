"use client";

/**
 * OpenFreeMap basemap provider (map-home, BRAWUKA-311). Ported from the
 * archived `_archive-coffeemode-frontend/src/components/map/OpenFreeMap.tsx`
 * with four deliberate fixes:
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
 *
 * No GeolocateControl: DG112 — geolocation is only ever user-triggered via
 * the onboarding LocateButton, never a map control.
 */
import { Map as MapLibreMap } from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { BaseMapProviderProps, IMapProvider } from "./types";


/** The imperative adapter handed to the surface — the only camera channel
 * after mount (initialCenter/initialZoom are constructor-time only). */
function providerAdapter(
  map: MapLibreMap,
  mapRef: React.RefObject<MapLibreMap | null>,
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
    destroy: () => {
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    },
  };
}
export function OpenFreeMapProvider({
  className,
  initialCenter,
  initialZoom,
  style,
  ariaLabel,
  onLoad,
  onError,
}: BaseMapProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
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

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container,
        style: style as StyleSpecification | string,
        center: [initialCenter.lng, initialCenter.lat],
        zoom: initialZoom,
        // Compliance: OpenMapTiles attribution must stay visible.
        attributionControl: { compact: false },
      });
    } catch (err) {
      // WebGL unavailable / style unparseable — degrade, don't crash.
      onErrorRef.current?.(err);
      return;
    }
    mapRef.current = map;

    let loaded = false;
    map.on("load", () => {
      loaded = true;
      onLoadRef.current?.(providerAdapter(map, mapRef), map);
    });

    map.on("error", (e) => {
      // Per-tile failures (e.tile set) are routine — a dropped tile leaves a
      // hole, not a dead map. Everything else before first paint (style,
      // source, glyphs, sprite) means the basemap cannot render.
      const tileBound = Boolean((e as { tile?: unknown }).tile);
      if (!loaded && !tileBound) onErrorRef.current?.(e.error ?? e);
      else console.error("[map] non-fatal maplibre error:", e.error ?? e);
    });

    return () => {
      map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once by design
  }, []);

  // Style switching (theme light/dark): setStyle replaces the style in
  // place; the surface re-adds its sources/layers on the next `style.load`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(style as StyleSpecification | string);
  }, [style]);

  return (
    <div
      ref={containerRef}
      className={className ? `h-full w-full ${className}` : "h-full w-full"}
      aria-label={ariaLabel ?? "Map"}
    />
  );
}
