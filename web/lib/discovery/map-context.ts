"use client";

/**
 * Discovery → map bridge (map-home, BRAWUKA-311). DiscoveryHome owns the
 * selection controller, the nearby-cafes query, and the resolved center;
 * the map surface mounts as its `children` slot, so this context is how the
 * map reads that state without prop-drilling through the server page.
 */
import { createContext, useContext } from "react";
import type { Coordinates } from "@/lib/cities";
import type { CafeSummary } from "@/types/cafes";
import type { DiscoveryController } from "./use-discovery-controller";

export interface DiscoveryMapState {
  controller: DiscoveryController;
  cafes: CafeSummary[];
  /** Resolved discovery center (onboarding city/location or configured
   * fallback) — the map flies here when it changes. */
  center: Coordinates;
}

export const DiscoveryMapContext = createContext<DiscoveryMapState | null>(null);

/** Null outside a DiscoveryHome tree — the map surface renders nothing. */
export function useDiscoveryMap(): DiscoveryMapState | null {
  return useContext(DiscoveryMapContext);
}
