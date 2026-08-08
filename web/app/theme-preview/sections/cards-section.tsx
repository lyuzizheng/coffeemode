"use client";

import { SearchField } from "@heroui/react";
import { useTranslations } from "next-intl";
import { CafeCard, Section } from "../shared";

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
