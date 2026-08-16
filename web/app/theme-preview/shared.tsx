"use client";

import { Chip, Label, Slider } from "@heroui/react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cardInteraction, spring, useEnterMotion } from "@/lib/motion";

export { Swatch, useResolvedColor, toDisplayHex } from "./color";

/* ------------------------------------------------------------------ shared */

export function Section({
  index,
  title,
  desc,
  children,
}: {
  index: string;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-separator py-14 first:border-t-0 first:pt-4">
      <div className="mb-8 max-w-2xl">
        <span className="tnum font-mono text-xs text-muted">{index}</span>
        <h2 className="mt-2 font-display text-xl font-bold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="mt-2 text-base leading-relaxed text-muted">{desc}</p>
      </div>
      {children}
    </section>
  );
}

/** Demo score used by every themed mock (poster, cards, success state). */
export const DEMO_SCORE = 87;

/**
 * One slider primitive for every themed demo (forms, score sliders, search
 * filters) — controlled, with an optional hint below (review 2026-08-09 D4).
 */
export function ScoreSlider({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <Slider
        value={value}
        onChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        minValue={0}
        maxValue={100}
        aria-label={label}
      >
        <div className="flex items-baseline justify-between">
          <Label>{label}</Label>
          <Slider.Output className="tnum font-mono text-md font-medium text-accent" />
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      {hint ? <p className="mt-2 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const DIMS = [
  { key: "wifi", value: 88 },
  { key: "outlets", value: 64 },
  { key: "seats", value: 72 },
  { key: "temp", value: 58 },
  { key: "coffee", value: 91 },
] as const;

export function WorkBar({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const enter = useEnterMotion();
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 truncate text-xs text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-tertiary">
        <motion.div
          key={enter ? "m" : "s"}
          className="h-full rounded-full bg-accent"
          {...(enter
            ? {
                initial: { width: 0 },
                whileInView: { width: `${value}%` },
                viewport: { once: true, margin: "-40px" },
                transition: spring.soft,
              }
            : { initial: false, animate: { width: `${value}%` }, transition: { duration: 0 } })}
        />
      </div>
      <span className="tnum w-7 shrink-0 text-right text-xs text-foreground">
        {value}
      </span>
    </div>
  );
}

export function CafeCard({ interactive = true }: { interactive?: boolean }) {
  const t = useTranslations("themePreview.cards");
  // Gesture props (whileHover/whileTap) make framer-motion add tabIndex to
  // SSR HTML; gate them on mount so server and first client render agree.
  const enter = useEnterMotion();
  return (
    <motion.div
      {...(interactive && enter ? cardInteraction : {})}
      className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-surface transition-shadow duration-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold tracking-tight text-foreground">
            {t("cafe_name")}
          </h3>
          <p className="mt-0.5 text-sm text-muted">{t("cafe_area")}</p>
          <div className="mt-2 flex items-center gap-2">
            <Chip color="success" variant="soft" size="sm">
              {t("open_now")}
            </Chip>
            <span className="tnum font-mono text-xs text-muted">
              {t("closes_at")}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum font-display text-2xl font-extrabold leading-none text-foreground">
            {DEMO_SCORE}
          </div>
          <div className="mt-1 text-xs text-muted">{t("work_score")}</div>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        {DIMS.map((d) => (
          <WorkBar
            key={d.key}
            label={t(`dims.${d.key}`)}
            value={d.value}
          />
        ))}
      </div>

      <div className="tnum mt-5 flex items-center gap-4 border-t border-separator pt-3 font-mono text-xs text-muted">
        <span>{t("distance")}</span>
        <span>{t("check_ins")}</span>
      </div>
    </motion.div>
  );
}
