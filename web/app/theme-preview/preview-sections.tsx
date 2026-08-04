"use client";

import {
  Button,
  Chip,
  Label,
  SearchField,
  Skeleton,
  Slider,
  Switch,
  TextField,
  Input,
} from "@heroui/react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo, useState, type ReactNode } from "react";
import { cardInteraction, duration, ease, spring } from "@/lib/motion";
import { useMounted } from "@/lib/use-mounted";

/* ------------------------------------------------------------------ shared */

function Section({
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
function useResolvedColor(token: string): string {
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
function toDisplayHex(color: string): string {
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

function Swatch({ token }: { token: string }) {
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
        {copied ? t("copied") : hex || " "}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------- color */

const BASE_TOKENS = [
  "background",
  "foreground",
  "surface",
  "surface-secondary",
  "surface-tertiary",
  "overlay",
  "muted",
  "border",
  "separator",
  "default",
  "default-hover",
  "default-soft",
];
const BRAND_TOKENS = [
  "accent",
  "accent-hover",
  "accent-soft",
  "accent-soft-foreground",
];
const STATUS_TOKENS = [
  "success",
  "success-soft",
  "warning",
  "warning-soft",
  "danger",
  "danger-soft",
];

export function ColorSection() {
  const t = useTranslations("themePreview.color");
  const groups: [string, string[]][] = [
    [t("group_base"), BASE_TOKENS],
    [t("group_brand"), BRAND_TOKENS],
    [t("group_status"), STATUS_TOKENS],
  ];
  return (
    <Section index="01" title={t("title")} desc={t("desc")}>
      <div className="space-y-8">
        {groups.map(([label, tokens]) => (
          <div key={label}>
            <h3 className="mb-3 text-sm font-medium text-foreground">
              {label}
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
              {tokens.map((token) => (
                <Swatch key={token} token={token} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- type */

const RAMP = [
  { cls: "font-display text-2xl font-extrabold", spec: "text-2xl · 32/40 · Cabinet 800" },
  { cls: "font-display text-xl font-bold", spec: "text-xl · 24/32 · Cabinet 700" },
  { cls: "font-display text-lg font-bold", spec: "text-lg · 20/28 · Cabinet 700" },
  { cls: "text-md font-semibold", spec: "text-md · 16/24 · Inter 600" },
  { cls: "text-base", spec: "text-base · 14/22 · Inter 400" },
  { cls: "text-sm text-muted", spec: "text-sm · 13/20 · Inter 400" },
  { cls: "font-mono text-xs text-muted", spec: "text-xs · 12/16 · JetBrains 400" },
];

export function TypeSection() {
  const t = useTranslations("themePreview.type");
  const cafeName = useTranslations("themePreview.cards")("cafe_name");
  return (
    <Section index="02" title={t("title")} desc={t("desc")}>
      <div className="space-y-10">
        {/* Type ramp */}
        <div>
          <h3 className="mb-4 text-sm font-medium text-foreground">
            {t("scale_label")}
          </h3>
          <div className="divide-y divide-separator rounded-xl border border-border bg-surface">
            {RAMP.map((row) => (
              <div
                key={row.spec}
                className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <span className={`truncate text-foreground ${row.cls}`}>
                  {cafeName}
                </span>
                <span className="tnum shrink-0 font-mono text-xs text-muted">
                  {row.spec}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Specimens */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="font-mono text-xs text-muted">{t("display_label")}</div>
            <div className="mt-3 font-display text-2xl font-extrabold tracking-tight text-foreground">
              {t("display_sample")}
            </div>
            <p className="mt-2 text-sm text-muted">{t("display_line")}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="font-mono text-xs text-muted">{t("sans_label")}</div>
            <p className="mt-3 text-base leading-relaxed text-foreground">
              {t("sans_sample")}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="font-mono text-xs text-muted">{t("mono_label")}</div>
            <p className="tnum mt-3 font-mono text-sm leading-relaxed text-foreground">
              {t("mono_sample")}
            </p>
          </div>
        </div>

        {/* Tabular numerals */}
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="font-mono text-xs text-muted">{t("tnum_label")}</div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
            {[87, 64, 100, 9].map((n) => (
              <span
                key={n}
                className="tnum font-display text-xl font-bold text-foreground"
              >
                {n}
                <span className="text-sm font-medium text-muted">/100</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{t("tnum_hint")}</p>
        </div>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- buttons */

export function ButtonsSection() {
  const t = useTranslations("themePreview.buttons");
  return (
    <Section index="03" title={t("title")} desc={t("desc")}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">{t("check_in")}</Button>
          <Button variant="secondary">{t("add_cafe")}</Button>
          <Button variant="tertiary">{t("save")}</Button>
          <Button variant="ghost">{t("cancel")}</Button>
          <Button variant="outline">{t("cancel")}</Button>
          <Button variant="danger">{t("delete")}</Button>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-xs text-muted">
          <span>{t("variant_primary")}</span>
          <span>{t("variant_secondary")}</span>
          <span>{t("variant_tertiary")}</span>
          <span>{t("variant_ghost")}</span>
          <span>{t("variant_outline")}</span>
          <span>{t("variant_danger")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-separator pt-6">
          <span className="w-16 font-mono text-xs text-muted">{t("sizes")}</span>
          <Button size="sm" variant="primary">{t("check_in")}</Button>
          <Button size="md" variant="primary">{t("check_in")}</Button>
          <Button size="lg" variant="primary">{t("check_in")}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-separator pt-6">
          <span className="w-16 font-mono text-xs text-muted">{t("states")}</span>
          <Button variant="primary" isDisabled>
            {t("unavailable")}
          </Button>
          <Button variant="outline" isDisabled>
            {t("unavailable")}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- cards */

const DIMS = [
  { key: "wifi", value: 88 },
  { key: "outlets", value: 64 },
  { key: "seats", value: 72 },
  { key: "temperature", value: 58 },
  { key: "coffee", value: 91 },
] as const;

function WorkBar({
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

export function CardsSection() {
  const t = useTranslations("themePreview.cards");
  return (
    <Section index="04" title={t("title")} desc={t("desc")}>
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div>
          <CafeCard />
          <p className="mt-3 font-mono text-xs text-muted">{t("hover_hint")}</p>
        </div>

        {/* Map overlay elevation demo */}
        <div
          className="relative min-h-72 overflow-hidden rounded-xl border border-border bg-surface-secondary"
          style={{
            backgroundImage:
              "radial-gradient(color-mix(in oklch, var(--foreground) 14%, transparent) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        >
          {/* Floating search overlay */}
          <div className="absolute inset-x-4 top-4 rounded-lg border border-border bg-overlay/85 shadow-map backdrop-blur-md">
            <SearchField aria-label={t("cafe_name")} className="w-full">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder={t("cafe_area")} />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </div>
          {/* Floating card overlay */}
          <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-lg border border-border bg-overlay/85 p-3 shadow-map backdrop-blur-md">
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-md font-bold text-foreground">
                {t("cafe_name")}
              </div>
              <div className="tnum font-mono text-xs text-muted">
                {t("distance")} · {t("closes_at")}
              </div>
            </div>
            <div className="tnum font-display text-lg font-extrabold text-accent">
              87
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- forms */

function ScoreSlider({
  label,
  hint,
  defaultValue,
}: {
  label: string;
  hint: string;
  defaultValue: number;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <Slider
        value={value}
        onChange={(v) => setValue(Array.isArray(v) ? v[0] : v)}
        minValue={0}
        maxValue={100}
        aria-label={label}
      >
        <div className="flex items-baseline justify-between">
          <Label>{label}</Label>
          <Slider.Output className="tnum font-mono text-md font-medium text-accent-soft-foreground" />
        </div>
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </div>
  );
}

export function FormsSection() {
  const t = useTranslations("themePreview.forms");
  const [openOnly, setOpenOnly] = useState(true);
  return (
    <Section index="05" title={t("title")} desc={t("desc")}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <SearchField className="w-full">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("search_placeholder")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <TextField className="w-full">
            <Label>{t("name_label")}</Label>
            <Input placeholder={t("name_placeholder")} />
          </TextField>

          <div className="rounded-xl border border-border bg-surface p-5">
            <Switch isSelected={openOnly} onChange={setOpenOnly}>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Switch.Content>
                <Label>{t("open_only")}</Label>
              </Switch.Content>
            </Switch>
            <p className="mt-2 text-xs text-muted">{t("open_only_hint")}</p>
          </div>

          <div>
            <div className="mb-2 font-mono text-xs text-muted">
              {t("policy_label")}
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip variant="secondary">{t("chip_minspend")}</Chip>
              <Chip variant="secondary">{t("chip_maxstay")}</Chip>
              <Chip color="success" variant="soft">
                {t("chip_laptops")}
              </Chip>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <ScoreSlider
            label={t("wifi_label")}
            hint={t("slider_hint")}
            defaultValue={72}
          />
          <ScoreSlider
            label={t("coffee_label")}
            hint={t("slider_hint")}
            defaultValue={91}
          />
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- skeleton */

export function SkeletonSection() {
  const t = useTranslations("themePreview.skeleton");
  const tc = useTranslations("themePreview.cards");
  const [loading, setLoading] = useState(true);
  return (
    <Section index="06" title={t("title")} desc={t("desc")}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_auto]">
        <div
          className="w-full max-w-sm rounded-xl border border-border bg-surface p-5"
          aria-busy={loading}
          aria-label={loading ? t("loading_aria") : undefined}
        >
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <div className="space-y-2.5 pt-3">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-1.5 flex-1 rounded-full" />
                    <Skeleton className="h-3 w-7" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
                {tc("cafe_name")}
              </h3>
              <p className="text-sm text-muted">{tc("cafe_area")}</p>
              <div className="space-y-2.5 pt-3">
                {DIMS.map((d) => (
                  <WorkBar key={d.key} label={tc(`dims.${d.key}`)} value={d.value} reduced />
                ))}
              </div>
              <p className="tnum font-mono text-xs text-muted">
                {tc("distance")} · {tc("check_ins")}
              </p>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          onPress={() => setLoading((v) => !v)}
          className="shrink-0"
        >
          {loading ? t("show_loaded") : t("show_loading")}
        </Button>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ motion */

const MOTION_TOKENS = [
  { key: "feedback", ms: 120 },
  { key: "state", ms: 200 },
  { key: "transition", ms: 300 },
  { key: "slow", ms: 450 },
] as const;

export function MotionSection() {
  const t = useTranslations("themePreview.motion");
  const td = useTranslations("themePreview.cards.dims");
  const reduced = useReducedMotion() ?? false;
  const [order, setOrder] = useState<string[]>(["wifi", "outlets", "seats", "coffee"]);

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
                    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="tnum font-mono text-xs text-muted">
          {t("ease_label")} · cubic-bezier(0.22, 1, 0.36, 1)
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
            {...(reduced ? {} : cardInteraction)}
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
            {...(reduced ? {} : cardInteraction)}
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
              <WorkBar label="wifi" value={88} reduced={reduced} />
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
