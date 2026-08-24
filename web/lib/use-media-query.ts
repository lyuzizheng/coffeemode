"use client";

import { useSyncExternalStore } from "react";

/**
 * Hydration-safe media query hook. The server snapshot is `false`, so the
 * first client render matches the server HTML; the real value applies after
 * mount. Discovery uses it for the 1024px mobile-sheet/desktop-columns
 * switch (DG20, spec 0004 18g).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
