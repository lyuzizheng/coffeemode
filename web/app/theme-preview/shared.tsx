"use client";

import { Chip } from "@heroui/react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo, useState, type ReactNode } from "react";
import { cardInteraction, spring } from "@/lib/motion";
import { useMounted } from "@/lib/use-mounted";

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

/** Resolves a token to a short display hex (#rrggbb), live per theme. */
export function useResolvedColor(token: string): string {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  return useMemo(() => {
    if (!mounted) return "";
    // Re-read the token when next-themes flips the .dark class.
    void resolvedTheme;
    const el = document.createElement("div");
    el.style.color = `var(--${token})`;
    el.style.display = "none";
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    el.remove();
    return toDisplayHex(computed);
  }, [mounted, token, resolvedTheme]);
}

/**
 * Normalizes any computed color to a caption: `#rrggbb`, or `#rrggbb · N%`
 * when the token is translucent (soft colors are color-mix with transparent).
 * String parsing can't keep up with CSS Color 4 (lab/oklch/color-mix survive
 * getComputedStyle intact), so the ground truth is a 1px canvas: Chrome
 * rasterizes the color into sRGB bytes, and getImageData's unpremultiplied
 * channels return the true fill color and alpha.
 */
export function toDisplayHex(color: string): string {
  const ctx = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  if (!ctx) return color;
  // Guard against invalid input: a failed fillStyle assignment is ignored.
  const probe = "#010203";
  ctx.fillStyle = probe;
  ctx.fillStyle = color;
  if (ctx.fillStyle === probe) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return a < 255 ? `${hex} · ${Math.round((a / 255) * 100)}%` : hex;
}

export function Swatch({ token }: { token: string }) {
  const t = useTranslations("themePreview.color");
  const hex = useResolvedColor(token);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!hex) return;
    try {
      await navigator.clipboard.writeText(hex);
    } catch {
      return; // clipboard unavailable (permissions) — no feedback to give
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={hex ? `Copy ${hex}` : undefined}
      className="group min-w-0 cursor-pointer text-left"
    >
      <div
        className="h-16 rounded-md border border-foreground/8 transition-transform duration-150 group-hover:-translate-y-0.5 group-active:translate-y-0"
        style={{ background: `var(--${token})` }}
      />
      <div className="mt-2 truncate font-mono text-xs text-foreground">
        --{token}
      </div>
      <div className="tnum truncate font-mono text-xs text-muted transition-colors duration-150 group-hover:text-foreground">
        {copied ? t("copied") : hex || "\u00a0"}
      </div>
    </button>
  );
}

export const DIMS = [
  { key: "wifi", value: 88 },
  { key: "outlets", value: 64 },
  { key: "seats", value: 72 },
  { key: "temperature", value: 58 },
  { key: "coffee", value: 91 },
] as const;

export function WorkBar({
  label,
  value,
  reduced,
}: {
  label: string;
  value: number;
  reduced: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 truncate text-xs text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-tertiary">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={reduced ? false : { width: 0 }}
          whileInView={{ width: `${value}%` }}
          viewport={{ once: true, margin: "-40px" }}
          transition={reduced ? { duration: 0 } : spring.soft}
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
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.div
      {...(interactive && !reduced ? cardInteraction : {})}
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
            87
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
            reduced={reduced}
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
