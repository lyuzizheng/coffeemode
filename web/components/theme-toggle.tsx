"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMounted } from "@/hooks/use-mounted";

const ICONS = {
  light: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  dark: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  ),
  system: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </svg>
  ),
} as const;

const ORDER = ["light", "dark", "system"] as const;
type ThemeValue = (typeof ORDER)[number];

/**
 * Single icon button that cycles light → dark → system (BRAWUKA-372): the
 * previous 3-segment labelled control measured 236×44px on desktop — far too
 * large for a low-frequency preference. One 44px button keeps the hit area
 * while the painted footprint stays a single icon. The icon reflects the
 * current theme; the aria-label announces the next state.
 */
export function ThemeToggle({
  variant = "default",
}: {
  /** "bare" drops the container chrome for embedding inside a parent chip
   * (map overlay) — the button itself is identical. */
  variant?: "default" | "bare";
}) {
  const t = useTranslations("themePreview.theme");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  const active: ThemeValue = mounted && (theme === "light" || theme === "dark" || theme === "system")
    ? theme
    : "system";
  const next: ThemeValue = ORDER[(ORDER.indexOf(active) + 1) % ORDER.length];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`${t("label")}: ${t(active)} → ${t(next)}`}
      title={`${t("label")}: ${t(active)}`}
      className={`cm-focus flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-surface-secondary hover:text-foreground active:scale-95 ${
        variant === "bare" ? "" : "border border-border bg-surface"
      }`}
    >
      {ICONS[active]}
    </button>
  );
}
