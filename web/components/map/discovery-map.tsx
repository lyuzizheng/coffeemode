"use client";

/**
 * Discovery map surface (map-home, BRAWUKA-311): the live basemap behind the
 * discovery sheet/sidebar. Binds the shared discovery state (map context) to
 * the map provider:
 *
 *  - cafes → clustered GeoJSON pins (spec 0001 marker: espresso circle,
 *    white cup, open/closed dot); pin tap → controller.select (URL sync is
 *    the controller's), cluster tap → zoom in
 *  - selectedCafeId → flyTo zoom; center changes (locate, city pick) → flyTo
 *  - theme (light/dark) → swaps the basemap style in place; cafe layers
 *    rebind on every style.load
 *  - basemap failure → error card — the sheet keeps working because the
 *    data path never touches the map
 *
 * Renderer-agnostic: this file binds to `IMapProvider` only — the provider
 * component is selected by `map.provider` via providers.ts (BRAWUKA-329) and
 * owns its own theme→style resolution (owner directive 2026-09-16: the map
 * is a replaceable layer).
 *
 * Loaded via next/dynamic ssr:false from map-surface.tsx — this module owns
 * the maplibre-gl import graph.
 */
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getMapDefaultZoom, getMapProvider } from "@/lib/client-env";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useDiscoveryMap } from "@/lib/discovery/map-context";
import { MAP_PROVIDERS } from "./providers";
import {
  useCafeData,
  useCenterSync,
  useMapPadding,
  useSelectionCamera,
} from "./use-map-bindings";
import type { IMapProvider } from "./types";

export function DiscoveryMap({
  onError,
  onReady,
}: {
  onError: (err: unknown) => void;
  /** First style load completed — the basemap is on screen; the surface
   * lifts the mosaic mask on this signal (BRAWUKA-506). */
  onReady?: () => void;
}) {
  const t = useTranslations("map");
  const state = useDiscoveryMap();
  const { resolvedTheme } = useTheme();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isXl = useMediaQuery("(min-width: 1280px)");

  const providerRef = useRef<IMapProvider | null>(null);
  // Latest select callback for the provider's tap handler.
  const selectRef = useRef<((id: string) => void) | null>(null);
  useEffect(() => {
    selectRef.current = state?.controller.select ?? null;
  });

  // `map.provider` selects the renderer; the provider owns theme→style.
  const Provider = MAP_PROVIDERS[getMapProvider()];
  useEffect(() => {
    if (!Provider) onError(new Error(`unknown map provider "${getMapProvider()}"`));
  }, [Provider, onError]);

  const center = state?.center ?? null;
  const cafes = useMemo(() => state?.cafes ?? [], [state?.cafes]);
  const selectedCafeId = state?.controller.selectedCafeId ?? null;
  const snap = state?.controller.snap ?? "peek";
  const [mapReady, setMapReady] = useState(false);
  const handleLoad = useCallback(
    (provider: IMapProvider) => {
      providerRef.current = provider;
      provider.onCafeSelect((cafeId) => selectRef.current?.(cafeId));
      setMapReady(true);
      onReady?.();
    },
    [onReady],
  );

  const refs = { providerRef };
  useMapPadding(refs, { isDesktop, isXl, snap, selectedCafeId, mapReady });
  useCenterSync(refs, center, mapReady);
  useSelectionCamera(refs, selectedCafeId, cafes, mapReady);
  useCafeData(refs, cafes, selectedCafeId, mapReady);

  if (!state || !Provider) return null;

  return (
    <Provider
      className="absolute inset-0"
      initialCenter={state.center}
      initialZoom={getMapDefaultZoom()}
      theme={resolvedTheme}
      ariaLabel={t("aria")}
      onLoad={handleLoad}
      onError={onError}
    />
  );
}
