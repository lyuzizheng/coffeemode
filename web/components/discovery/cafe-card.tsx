"use client";

/**
 * Cafe card — one composition, two surfaces (BRAWUKA-364 field-guide
 * redesign): `card` is the boxed PEEK-strip card; `row` is the desktop
 * index row (no chrome of its own — the row button carries selection).
 * Scan-first: monogram/cover tile, display name, meta, ≤4 characteristic
 * facts, and the Work plate — a printed score block, not a watermark.
 * No actions in PEEK — the whole card is the tap target.
 */
import { useLocale, useTranslations } from "next-intl";
import { cafeFacts, formatDistanceKm } from "@/lib/discovery/view-model";
import { displayCityName } from "@/lib/cities";
import { PrivateBadge } from "@/components/cafe/private-badge";
import type { CafeSummary } from "@/types/cafes";
import { CoverTile, FactsRow } from "./card-parts";

/** Meta line: `area · 1.2 km` — the Work score moved to the plate (DG43). */
function CardMeta({ cafe }: { cafe: CafeSummary }) {
  const t = useTranslations("discovery");
  const locale = useLocale();
  const km = formatDistanceKm(cafe.distance_m);
  const parts = [displayCityName(cafe.city, locale), km !== null ? t("km_away", { km }) : null].filter(Boolean);
  return <p className="tnum truncate text-xs text-muted">{parts.join(" · ")}</p>;
}


/**
 * The Work plate — the card's verdict block: a tabular numeral over a
 * 2px accent rule whose width is the score, with the plate label beneath.
 * `null` renders an honest em-dash, never a fake zero.
 */
function WorkPlate({ score }: { score: number | null }) {
  const t = useTranslations("discovery");
  return (
    <div className="flex w-11 shrink-0 flex-col items-end gap-1 self-center">
      <span
        className="tnum font-mono text-lg leading-none text-foreground"
        role="img"
        aria-label={score === null ? undefined : t("work_score_aria", { score })}
      >
        {score ?? "—"}
      </span>
      <span aria-hidden className="h-0.5 w-full rounded-full bg-surface-tertiary">
        {score !== null && (
          <span className="block h-full rounded-full bg-accent" style={{ width: `${score}%` }} />
        )}
      </span>
      <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted">
        {t("work")}
      </span>
    </div>
  );
}

/**
 * Card body shared by the PEEK carousel (`card`) and the desktop index
 * (`row`). The row variant drops its own chrome — the parent row button
 * owns border/selection so the index reads as one printed list.
 */
export function CafeCardBody({
  cafe,
  variant = "card",
}: {
  cafe: CafeSummary;
  variant?: "card" | "row";
}) {
  const work =
    cafe.work_stats.composite_score === null
      ? null
      : Math.round(cafe.work_stats.composite_score);
  return (
    <div
      className={
        variant === "card"
          ? "relative flex gap-3 overflow-hidden rounded-md border border-separator bg-surface p-3 shadow-sm transition-shadow duration-150 hover:shadow-md"
          : "relative flex gap-3 px-4 py-3"
      }
    >
      <CoverTile
        cafe={cafe}
        className={
          variant === "card"
            ? "h-[var(--layout-thumb)] w-[var(--layout-card-cover-w)]"
            : "h-[var(--layout-row-cover-h)] w-[var(--layout-row-cover-w)]"
        }
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate font-display text-md font-bold tracking-tight text-foreground">
            {cafe.name}
          </h3>
          {/* DG147: private rows only ever reach the owner (read-path filter). */}
          {cafe.visibility === "private" && <PrivateBadge />}
        </div>
        <CardMeta cafe={cafe} />
        <FactsRow facts={cafeFacts(cafe)} />
      </div>
      <WorkPlate score={work} />
    </div>
  );
}
