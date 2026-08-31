"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";

/* ------------------------------------------------------------------ colors */
/* Color utilities for the token inspector. Split out of shared.tsx so the
   canvas/probe machinery lives with the swatch UI it powers (review
   2026-08-09 C8). */

let displayCtx: CanvasRenderingContext2D | null | undefined;

function getDisplayCtx(): CanvasRenderingContext2D | null {
  if (displayCtx === undefined) {
    const canvas = typeof document === "undefined" ? null : document.createElement("canvas");
    displayCtx = canvas ? canvas.getContext("2d", { willReadFrequently: true }) : null;
  }
  return displayCtx;
}

/**
 * Normalizes any CSS color string to a caption: `#rrggbb`, or `#rrggbb · N%`
 * when the token is translucent. String parsing can't keep up with CSS Color 4
 * (lab/oklch/color-mix survive getComputedStyle intact), so the ground truth
 * is a 1px canvas: Chrome rasterizes the color into sRGB bytes, and
 * getImageData's unpremultiplied channels return the true fill color and alpha.
 */
export function toDisplayHex(color: string): string {
  const ctx = getDisplayCtx();
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

/** Hidden, singleton element used to resolve CSS variables that contain color-mix/var(). */
let colorProbe: HTMLDivElement | null = null;

function getColorProbe(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (!colorProbe) {
    colorProbe = document.createElement("div");
    colorProbe.style.cssText =
      "position:absolute;visibility:hidden;width:0;height:0;overflow:hidden;";
    document.body.appendChild(colorProbe);
  }
  return colorProbe;
}

/** Resolves a token to a short display hex (#rrggbb), live per theme.
 *  A hidden probe element is used because canvas cannot parse color-mix()
 *  expressions that reference CSS variables; getComputedStyle resolves the
 *  full chain for us. Re-probes when next-themes flips the theme class.
 */
export function useResolvedColor(token: string): string {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  return useMemo(() => {
    if (!mounted) return "";
    // Re-read when next-themes flips the .dark class.
    void resolvedTheme;
    const probe = getColorProbe();
    if (!probe) return "";
    probe.style.color = `var(--${token})`;
    return toDisplayHex(getComputedStyle(probe).color);
  }, [mounted, token, resolvedTheme]);
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
      title={hex ? t("copy_title", { hex }) : undefined}
      className="cm-focus group min-w-0 cursor-pointer text-left"
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
