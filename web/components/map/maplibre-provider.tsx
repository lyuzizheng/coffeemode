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
 * Optional IMapProvider capabilities (BRAWUKA-330): `getBounds`,
 * `onIdle` (MapLibre `moveend` — camera-settled, not the render-idle event,
 * so a data refresh can't retrigger "search this area"), and
 * `setExternalPins` (sage teardrop POI pins on a source/layers separate
 * from the cafe dataset).
 */
import { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { mountMap } from "./maplibre-mount";
import { mapLibreStyleForTheme } from "./maplibre-config";
import type { ProviderState } from "./maplibre-state";
import type { BaseMapProviderProps } from "./types";

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
    userLocation: null,
    selectedCafeId: null,
    onCafeSelect: null,
    onCameraGesture: null,
    stylePending: false,
  });
  // The style the map was constructed with / last switched to — lets the
  // theme effect skip the redundant first-run setStyle (the constructor
  // already received it; on dark mode that was a second fetch of the same
  // style document).
  const appliedStyleRef = useRef(mapLibreStyleForTheme(theme));
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
  // Skipped when the resolved style is already applied — including the
  // mount run, where the constructor just received it.
  useEffect(() => {
    const map = mapRef.current;
    const next = mapLibreStyleForTheme(theme);
    if (!map || appliedStyleRef.current === next) return;
    stateRef.current.stylePending = true;
    map.setStyle(next);
    appliedStyleRef.current = next;
  }, [theme]);

  return (
    <div
      ref={containerRef}
      className={className ? `h-full w-full ${className}` : "h-full w-full"}
      aria-label={ariaLabel ?? "Map"}
    />
  );
}
