/**
 * Basemap provider registry (BRAWUKA-329): `map.provider` in app.yaml selects
 * the component. Adding a provider = a new `IMapProvider` implementation +
 * one entry here + a `map.<provider>` config block — `discovery-map.tsx`
 * never changes.
 */
import type { ComponentType } from "react";
import { MapLibreProvider } from "./maplibre-provider";
import type { BaseMapProviderProps } from "./types";

export const MAP_PROVIDERS: Record<string, ComponentType<BaseMapProviderProps>> = {
  maplibre: MapLibreProvider,
};
