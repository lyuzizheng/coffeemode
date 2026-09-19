"use client";

/**
 * Design-variant controller (BRAWUKA-370 owner directive): a second theme axis
 * orthogonal to next-themes' light/dark. `data-variant` on <html> selects the
 * shape/typography voice; the color plates stay shared.
 *
 *   default — spec 0002 dense scale (2/4/6/8px radius), Inter chrome
 *   retro   — zero radius, serif (Source Serif 4) UI voice
 *   modern  — generous radius (8/12/16/20px), Inter chrome
 *
 * Persistence: localStorage only (no server round-trip). An inline script in
 * app/layout.tsx applies the attribute before first paint so there is no
 * flash of the wrong variant.
 */
import { useCallback, useSyncExternalStore } from "react";
import { THEME_VARIANT_STORAGE_KEY } from "./theme-variant-const";

export const VARIANTS = ["default", "retro", "modern"] as const;
export type ThemeVariant = (typeof VARIANTS)[number];

function read(): ThemeVariant {
  if (typeof window === "undefined") return "default";
  try {
    const v = window.localStorage.getItem(THEME_VARIANT_STORAGE_KEY);
    return v === "retro" || v === "modern" ? v : "default";
  } catch {
    return "default"; // jsdom / privacy-mode localStorage denial
  }
}

function apply(variant: ThemeVariant) {
  const el = document.documentElement;
  if (variant === "default") el.removeAttribute("data-variant");
  else el.setAttribute("data-variant", variant);
}

// External store: localStorage + the storage event so multiple hook instances
// stay in sync within the tab (and across tabs).
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_VARIANT_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useThemeVariant(): {
  variant: ThemeVariant;
  setVariant: (v: ThemeVariant) => void;
} {
  const variant = useSyncExternalStore(subscribe, read, () => "default" as ThemeVariant);
  const setVariant = useCallback((v: ThemeVariant) => {
    try {
      window.localStorage.setItem(THEME_VARIANT_STORAGE_KEY, v);
    } catch { /* storage denied — variant still applies for the session */ }
    apply(v);
    listeners.forEach((cb) => cb());
  }, []);
  return { variant, setVariant };
}
