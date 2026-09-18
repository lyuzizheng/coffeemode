"use client";

/**
 * Design-variant picker (BRAWUKA-370 mechanism, BRAWUKA-505 previews):
 * three-option segmented control for the design-personality axis — default
 * (dense spec scale), retro (zero radius + serif editorial voice), modern
 * (concentric radius + mono data voice). Lives in /profile Preferences and
 * the anonymous gate footer; persists via useThemeVariant (localStorage +
 * data-variant on <html>).
 *
 * Each option carries a mini preview that renders with the REAL variant
 * tokens: the swatch sets `data-variant` on itself, so radius/font/shadow
 * custom properties resolve inside the subtree exactly as they would
 * app-wide. `[data-variant="default"]` in globals.css pins the default
 * personality so the preview stays honest under another active variant.
 */
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useSprings } from "@/lib/motion";
import { useMounted } from "@/hooks/use-mounted";
import { useThemeVariant, VARIANTS, type ThemeVariant } from "@/lib/theme-variant";

/** Mini preview tile: a surface chip with a display glyph, an accent rule,
 *  and a tabular numeral — the three tells of each personality (shape,
 *  typeface, data voice). `data-variant` scopes the variant's tokens to
 *  this subtree; the tile always shows the light plate. */
function VariantSwatch({ variant }: { variant: ThemeVariant }) {
  return (
    <span
      data-variant={variant}
      aria-hidden
      className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface px-2"
    >
      <span className="font-display text-sm font-bold leading-none text-foreground">Aa</span>
      <span className="tnum text-[10px] leading-none text-muted">87</span>
      <span className="h-1 w-4 rounded-full bg-accent" />
    </span>
  );
}

export function ThemeVariantPicker() {
  const t = useTranslations("profile.variant");
  const { variant, setVariant } = useThemeVariant();
  const reduced = useReducedMotion();
  const springs = useSprings();
  const mounted = useMounted();

  // SSR/CSR parity: the stored variant is unknown until mount — render an
  // inert track of the same size so the footer doesn't shift or mismatch.
  if (!mounted) {
    return <div className="h-[4.75rem] rounded-md bg-surface-secondary" aria-hidden />;
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex items-stretch gap-0.5 rounded-md bg-surface-secondary p-0.5"
    >
      {VARIANTS.map((v: ThemeVariant) => {
        const selected = variant === v;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={selected}
            onClick={() => setVariant(v)}
            className={`cm-focus relative flex min-h-11 flex-1 flex-col justify-center gap-1 rounded-sm px-2 py-1.5 transition-colors duration-150 ${
              selected ? "text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {selected && (
              <motion.span
                layoutId="variant-picker-thumb"
                className="absolute inset-0 rounded-sm bg-surface shadow-sm"
                transition={reduced ? { duration: 0 } : springs.snappy}
              />
            )}
            <span className="relative">
              <VariantSwatch variant={v} />
            </span>
            <span className="relative flex items-baseline justify-center gap-1">
              <span className="text-sm leading-none">{t(v)}</span>
              <span className="text-[10px] leading-none text-muted">{t(`${v}_hint`)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
