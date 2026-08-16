"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cardInteraction, duration, ease, spring, useEnterMotion } from "@/lib/motion";
import { Section, WorkBar } from "../shared";

const MOTION_TOKENS = [
  { key: "feedback", ms: 120 },
  { key: "state", ms: 200 },
  { key: "transition", ms: 300 },
  { key: "slow", ms: 450 },
] as const;

const DIM_KEYS = ["wifi", "outlets", "seats", "coffee"] as const;
type DimKey = (typeof DIM_KEYS)[number];

export function MotionSection() {
  const t = useTranslations("themePreview.motion");
  const td = useTranslations("themePreview.cards.dims");
  const reduced = useReducedMotion() ?? false;
  const enter = useEnterMotion();
  const [order, setOrder] = useState<DimKey[]>([...DIM_KEYS]);

  return (
    <Section index="07" title={t("title")} desc={t("desc")}>
      <div className="space-y-8">
        {/* Duration tokens — hover each card; the dot travels at that duration */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MOTION_TOKENS.map((token) => (
            <div
              key={token.key}
              className="group rounded-xl border border-border bg-surface p-4"
            >
              <div className="tnum font-mono text-md font-medium text-foreground">
                {token.ms}ms
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {t(token.key)}
              </div>
              <div className="text-xs text-muted">{t(`${token.key}_desc`)}</div>
              <div className="relative mt-4 h-1.5 rounded-full bg-surface-tertiary">
                <span
                  className="absolute top-0 left-0 h-full w-4 rounded-full bg-accent transition-[left] group-hover:left-[calc(100%-1rem)] motion-reduce:transition-none"
                  style={{
                    transitionDuration: `${token.ms}ms`,
                    transitionTimingFunction: ease.default.join(", "),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="tnum font-mono text-xs text-muted">
          {t("ease_label")} · {ease.default.join(", ")}
        </div>

        {/* Layout reflow demo */}
        <div>
          <p className="mb-3 text-sm text-muted">{t("demo_reflow")}</p>
          <ul className="flex flex-wrap gap-2">
            {order.map((key) => (
              <motion.li
                key={key}
                layout
                transition={reduced ? { duration: 0 } : spring.gentle}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOrder((prev) => [...prev.slice(1), prev[0]])
                  }
                  className="rounded-lg border border-border bg-surface px-3.5 py-1.5 text-sm text-foreground transition-colors duration-150 hover:bg-surface-secondary active:scale-[0.97]"
                >
                  {td(key)}
                </button>
              </motion.li>
            ))}
          </ul>
        </div>

        {/* Hover / press demo */}
        <div className="flex flex-wrap gap-4">
          <motion.div
            {...(enter ? cardInteraction : {})}
            className="cursor-default rounded-xl border border-border bg-surface px-5 py-4 shadow-surface"
          >
            <div className="text-sm font-medium text-foreground">
              {t("demo_hover")}
            </div>
            <div className="tnum font-mono text-xs text-muted">
              y −2px · {duration.feedback * 1000}ms
            </div>
          </motion.div>
          <motion.div
            {...(enter ? cardInteraction : {})}
            className="cursor-default rounded-xl border border-border bg-surface px-5 py-4 shadow-surface"
          >
            <div className="text-sm font-medium text-foreground">
              {t("demo_press")}
            </div>
            <div className="tnum font-mono text-xs text-muted">
              scale 0.985 · {duration.feedback * 1000}ms
            </div>
          </motion.div>
          <div className="rounded-xl border border-border bg-surface px-5 py-4">
            <div className="text-sm font-medium text-foreground">
              {t("demo_bars")}
            </div>
            <div className="mt-2 w-40">
              <WorkBar label={td("wifi")} value={88} />
            </div>
          </div>
        </div>
        <div className="tnum font-mono text-xs text-muted">
          ease.default: {ease.default.join(", ")}
        </div>
      </div>
    </Section>
  );
}
