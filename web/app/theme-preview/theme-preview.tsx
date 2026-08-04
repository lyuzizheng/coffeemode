"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ThemeToggle } from "@/components/theme-toggle";
import { duration, ease } from "@/lib/motion";
import {
  ButtonsSection,
  CafeCard,
  CardsSection,
  ColorSection,
  FormsSection,
  MotionSection,
  SkeletonSection,
  TypeSection,
} from "./preview-sections";

/**
 * The opening moment: a terracotta poster that shows the whole system in one
 * glance — display type, brand color, mono metadata — with a live score card
 * breaking its lower edge. Enters with the slow reveal (450ms, the only place
 * it is allowed), skipped entirely under reduced motion.
 */
function HeroPoster() {
  const t = useTranslations("themePreview");
  const tc = useTranslations("themePreview.cards");
  const ta = useTranslations("app");
  const reduced = useReducedMotion() ?? false;

  const enter = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 16 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: duration.slow, ease: ease.default },
      };

  return (
    <motion.div {...enter} className="relative">
      {/* Poster */}
      <div className="rounded-2xl bg-accent p-7 text-accent-foreground sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="font-display text-2xl font-extrabold leading-none tracking-tight sm:text-[2.5rem]">
            Coffee
            <br />
            Mode
          </div>
          <div className="tnum font-display text-2xl font-extrabold leading-none opacity-90">
            87
          </div>
        </div>
        <p className="mt-5 max-w-56 text-base leading-relaxed opacity-85">
          {ta("tagline")}
        </p>
        <div className="mt-8 border-t border-accent-foreground/20 pt-4 font-mono text-xs opacity-75">
          Cabinet Grotesk · Inter · JetBrains Mono
        </div>
      </div>

      {/* Score card breaking the poster's edge */}
      <motion.div
        {...(reduced
          ? {}
          : {
              initial: { opacity: 0, y: 10 },
              animate: { opacity: 1, y: 0 },
              transition: {
                duration: duration.slow,
                ease: ease.default,
                delay: 0.12,
              },
            })}
        className="relative z-10 -mt-6 mr-5 ml-auto w-56 rounded-xl border border-border bg-overlay p-4 shadow-map"
      >
        <div className="truncate font-display text-md font-bold tracking-tight text-foreground">
          {tc("cafe_name")}
        </div>
        <div className="tnum mt-1 font-mono text-xs text-muted">
          {tc("distance")} · {tc("closes_at")}
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-tertiary">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={reduced ? false : { width: 0 }}
              animate={{ width: "87%" }}
              transition={
                reduced
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 180, damping: 26, delay: 0.2 }
              }
            />
          </div>
          <span className="tnum text-xs font-medium text-foreground">87</span>
        </div>
      </motion.div>

      {/* Caption */}
      <p className="mt-5 font-mono text-xs text-muted">{t("header.poster_caption")}</p>
    </motion.div>
  );
}

export function ThemePreview() {
  const t = useTranslations("themePreview");
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-separator bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <span className="font-display text-md font-extrabold tracking-tight">
            CoffeeMode
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-24 sm:px-8">
        {/* Hero */}
        <div className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="font-mono text-xs text-muted">
              {t("header.kicker")}
            </span>
            <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight sm:text-[2.75rem] sm:leading-[3.25rem]">
              {t("meta_title")}
            </h1>
            <p className="mt-4 max-w-xl text-md leading-relaxed text-muted">
              {t("header.intro")}
            </p>
          </div>
          <HeroPoster />
        </div>

        <ColorSection />
        <TypeSection />
        <ButtonsSection />
        <CardsSection />
        <FormsSection />
        <SkeletonSection />
        <MotionSection />

        <footer className="mt-8 border-t border-separator pt-6">
          <p className="font-mono text-xs text-muted">{t("footer")}</p>
        </footer>
      </main>
    </div>
  );
}

// Re-export for potential reuse in later slices (e.g. component sandbox).
export { CafeCard };
