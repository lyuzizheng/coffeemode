"use client";

/**
 * Design-variant picker (BRAWUKA-370): three-option segmented control for the
 * shape/typography axis — default (dense spec scale), retro (zero radius +
 * serif voice), modern (generous radius). Lives in /profile Preferences and
 * the anonymous gate footer; persists via useThemeVariant (localStorage +
 * data-variant on <html>).
 */
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { spring } from "@/lib/motion";
import { useMounted } from "@/hooks/use-mounted";
import { useThemeVariant, VARIANTS, type ThemeVariant } from "@/lib/theme-variant";

export function ThemeVariantPicker() {
  const t = useTranslations("profile.variant");
  const { variant, setVariant } = useThemeVariant();
  const reduced = useReducedMotion();
  const mounted = useMounted();

  // SSR/CSR parity: the stored variant is unknown until mount — render an
  // inert track of the same size so the footer doesn't shift or mismatch.
  if (!mounted) {
    return <div className="h-12 rounded-md bg-default" aria-hidden />;
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex items-center gap-0.5 rounded-md bg-default p-0.5"
    >
      {VARIANTS.map((v: ThemeVariant) => {
        const selected = variant === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={selected}
            onClick={() => setVariant(v)}
            className={`cm-focus relative flex min-h-11 flex-1 items-center justify-center rounded-sm px-3 text-sm transition-colors duration-150 ${
              selected ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {selected && (
              <motion.span
                layoutId="variant-picker-thumb"
                className="absolute inset-0 rounded-sm bg-surface shadow-sm"
                transition={reduced ? { duration: 0 } : spring.snappy}
              />
            )}
            <span className="relative">{t(v)}</span>
          </button>
        );
      })}
    </div>
  );
}
