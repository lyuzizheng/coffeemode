"use client";

/**
 * Cafe card — one composition, two surfaces (BRAWUKA-364 field-guide
 * redesign): `card` is the boxed PEEK-strip card; `row` is the desktop
 * index row (no chrome of its own — the row button carries selection).
 * Scan-first: monogram/cover tile, display name, meta, ≤4 characteristic
 * facts, and the Work plate — a printed score block, not a watermark.
 * No actions in PEEK — the whole card is the tap target.
 */
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import {
  CoffeeIcon,
  OutletsIcon,
  SeatsIcon,
  StayIcon,
  TempIcon,
  WifiIcon,
  type IconProps,
} from "@/components/icons";
import { cafeFacts, formatDistanceKm, type Fact, type FactKind } from "@/lib/discovery/view-model";
import { displayCityName } from "@/lib/cities";
import { CARD_COVER_W_PX } from "@/lib/layout";
import type { CafeSummary } from "@/types/cafes";

const FACT_ICONS: Record<FactKind, (props: IconProps) => React.ReactNode> = {
  wifi: WifiIcon,
  outlets: OutletsIcon,
  stay: StayIcon,
  seats: SeatsIcon,
  temp: TempIcon,
  coffee: CoffeeIcon,
};

/** Stay fact label: 3h/2h/1h pass through, unlimited → ∞, peak translates. */
function StayFactLabel({ value }: { value: string }) {
  const t = useTranslations("discovery");
  if (value === "unlimited") return <>∞</>;
  if (value === "peak") return <>{t("policy.max_stay.peak")}</>;
  return <>{value}</>;
}

/** Characteristic icon row: 14px icons + text-xs values, never icon-only. */
export function FactsRow({ facts }: { facts: Fact[] }) {
  const t = useTranslations("discovery");
  if (facts.length === 0) return null;
  return (
    <div className="flex items-center gap-3">
      {facts.map((fact) => {
        const Icon = FACT_ICONS[fact.kind];
        return (
          <span key={fact.kind} className="flex items-center gap-1 text-xs text-muted">
            <Icon size={14} />
            <span className="tnum">
              {fact.kind === "stay" ? <StayFactLabel value={fact.value} /> : fact.value}
            </span>
            <span className="sr-only">{t(`facts.${fact.kind}`)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Meta line: `area · 1.2 km` — the Work score moved to the plate (DG43). */
function CardMeta({ cafe }: { cafe: CafeSummary }) {
  const t = useTranslations("discovery");
  const locale = useLocale();
  const km = formatDistanceKm(cafe.distance_m);
  const parts = [displayCityName(cafe.city, locale), km !== null ? t("km_away", { km }) : null].filter(Boolean);
  return <p className="tnum truncate text-xs text-muted">{parts.join(" · ")}</p>;
}

/**
 * Cover tile: the photo when one exists, else the cafe's monogram on a warm
 * tonal plate — a designed placeholder, never a bare gray box.
 */
function CoverTile({ cafe, className }: { cafe: CafeSummary; className: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-sm border border-separator bg-surface-secondary ${className}`}
    >
      {cafe.cover ? (
        <Image src={cafe.cover} alt="" fill sizes={`${CARD_COVER_W_PX}px`} className="object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center font-display text-xl font-extrabold text-foreground/25 select-none"
        >
          {cafe.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
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
          : "relative flex gap-3 p-3"
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
        <h3 className="truncate font-display text-md font-bold tracking-tight text-foreground">
          {cafe.name}
        </h3>
        <CardMeta cafe={cafe} />
        <FactsRow facts={cafeFacts(cafe)} />
      </div>
      <WorkPlate score={work} />
    </div>
  );
}
