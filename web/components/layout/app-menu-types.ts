/**
 * Shared types for the AppMenu cluster (BRAWUKA-504): the `map` namespace
 * translator and the theme-cycle value — used by both the trigger chrome
 * (app-menu.tsx) and the droplet panel (app-menu-panel.tsx).
 */
import type { useTranslations } from "next-intl";

export const THEME_ORDER = ["light", "dark", "system"] as const;
export type ThemeValue = (typeof THEME_ORDER)[number];

/** The `map` namespace translator — MenuPanel receives it from AppMenu. */
export type MapTranslator = ReturnType<typeof useTranslations<"map">>;
