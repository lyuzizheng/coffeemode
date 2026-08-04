"use client";

import { useSyncExternalStore } from "react";

/**
 * Hydration-safe "mounted" flag: false on the server and first client render,
 * true after — without setState-in-effect. Use to gate DOM-only reads
 * (getComputedStyle, matchMedia) during render.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
