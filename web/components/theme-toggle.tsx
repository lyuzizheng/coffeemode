"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { duration, ease } from "@/lib/motion";
import { useMounted } from "@/hooks/use-mounted";

const OPTIONS = [
  {
    value: "light",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    value: "dark",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
    ),
  },
  {
    value: "system",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8m-4-4v4" />
      </svg>
    ),
  },
] as const;

/**
 * Segmented light/dark/system control. The sliding thumb is a Framer Motion
 * layout animation; it collapses to an instant swap under reduced motion.
 */
export function ThemeToggle() {
  const t = useTranslations("themePreview.theme");
  const { theme, setTheme } = useTheme();
  const reduced = useReducedMotion();
  const mounted = useMounted();

  const active = mounted ? (theme ?? "system") : "system";

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex items-center gap-0.5 rounded-lg border border-border bg-default p-0.5"
    >
      {OPTIONS.map((opt) => {
        const selected = active === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            aria-label={t(opt.value)}
            onClick={() => setTheme(opt.value)}
            className={`cm-focus relative flex h-10 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors duration-150 sm:px-3 ${
              selected ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {selected && (
              <motion.span
                layoutId="theme-toggle-thumb"
                className="absolute inset-0 rounded-md bg-surface shadow-sm"
                transition={
                  reduced
                    ? { duration: 0 }
                    : { duration: duration.state, ease: ease.default }
                }
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {opt.icon}
              {/* Icon-only on narrow screens so the header keeps its balance. */}
              <span className="hidden sm:inline">{t(opt.value)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
