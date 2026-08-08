"use client";

import { useTranslations } from "next-intl";
import { Section } from "../shared";

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
